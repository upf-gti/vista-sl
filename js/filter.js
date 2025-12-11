/**
 * Bone Kalman Filter (MEKF-like) para un solo hueso
 * - Solo depende de THREE.js
 * - Estado: quaternion q (Three.Quaternion) y bias b (Three.Vector3)
 * - Covarianza P: 6x6 (3 para delta_theta, 3 para bias)
 *
 * Usage:
 *   const kf = new BoneKalmanFilter(dt);
 *   // cada frame:
 *   // omega = estimated angular velocity (Three.Vector3) from your buffer (rad/s)
 *   // qMeas = measurement quaternion (Three.Quaternion) from landmarks
 *   kf.step(omega, qMeas);
 *   const qFiltered = kf.q; // Three.Quaternion filtered
 *   const bias = kf.b;      // Three.Vector3 estimated bias
 */

import * as THREE from 'three';

class BoneKalmanFilter {
  constructor() {
  
    // State
    this.q = new THREE.Quaternion();        // orientation state
    this.b = new THREE.Vector3(0,0,0);      // gyro bias estimate

    // Covariance P (6x6): layout [ P11 P12; P21 P22 ] where P11 3x3 for attitude error
    this.P = BoneKalmanFilter.zeroMat6();

    // Initialize small uncertainty
    const pAtt = 1e-3;
    const pBias = 1e-4;
    BoneKalmanFilter.setBlock3(this.P, 0, 0, BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), pAtt));
    BoneKalmanFilter.setBlock3(this.P, 3, 3, BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), pBias));

    // Process noise Q (6x6)
    // Q = diag( sigma_att^2 * I3, sigma_bias^2 * I3 )
    const sigmaAtt = 1e-3;
    const sigmaBias = 1e-5;
    this.Q = BoneKalmanFilter.zeroMat6();
    BoneKalmanFilter.setBlock3(this.Q, 0, 0, BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), sigmaAtt*sigmaAtt));
    BoneKalmanFilter.setBlock3(this.Q, 3, 3, BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), sigmaBias*sigmaBias));

    // Measurement noise R (3x3) for angle vector (rad^2)
    const sigmaMeas = 5e-3; // tune according to jitter
    this.R = BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), sigmaMeas*sigmaMeas);
  }

  // ---------------------------
  // Public API
  // ---------------------------

  /**
   * One filter step: predict + update
   * @param {THREE.Vector3} omegaMeas - measured angular velocity (rad/s) estimated from buffer
   * @param {THREE.Quaternion} qMeas - measured orientation quaternion (Three.Quaternion)
   */
  step(omegaMeas, qMeas, dt) {
    this.predict(omegaMeas, dt);
    this.update(qMeas);
  }

  // ---------------------------
  // Predict: integrate quaternion and propagate covariance
  // ---------------------------
  predict(omegaMeas, dt) {
    // effective angular velocity used for integration (subtract bias)
    const omega = new THREE.Vector3().copy(omegaMeas).sub(this.b); // ω = ω_meas - b

    // integrate quaternion: q <- q * exp(0.5 * ω * dt)  (right-multiply small rotation)
    const deltaQ = BoneKalmanFilter.quatFromOmega(omega, dt);
    this.q.multiply(deltaQ).normalize();

    // Linearized state transition F (6x6):
    // F = [ I - skew(ω)*dt   -I*dt
    //       0                 I    ]
    const I3 = BoneKalmanFilter.identity3();
    const skewW = BoneKalmanFilter.skew(omega);
    const minusSkewDt = BoneKalmanFilter.scaleMat3(skewW, -dt);
    const F = BoneKalmanFilter.identity6();
    // top-left block = I + (-skew * dt)
    const topLeft = BoneKalmanFilter.addMat3(I3, minusSkewDt);
    BoneKalmanFilter.setBlock3(F, 0, 0, topLeft);
    // top-right block = -I * dt
    BoneKalmanFilter.setBlock3(F, 0, 3, BoneKalmanFilter.scaleMat3(I3, -dt));
    // bottom-right block stays identity

    // P = F * P * F^T + Q
    const FP = BoneKalmanFilter.mulMat6(F, this.P);
    const FPFt = BoneKalmanFilter.mulMat6(FP, BoneKalmanFilter.transpose6(F));
    this.P = BoneKalmanFilter.addMat6(FPFt, this.Q);
  }

  // ---------------------------
  // Update: measurement qMeas
  // ---------------------------
  update(qMeas, dt) {
    // Predicted quaternion: this.q
    // Compute quaternion error: q_err = q_meas * q_pred^{-1}
    const qPredInv = this.q.clone().invert();
    const qErr = qMeas.clone().multiply(qPredInv).normalize();

    // Convert qErr to small-angle vector z (3x1): axis * angle
    // angle = 2 * acos(w), axis = (x,y,z)/sin(angle/2)
    let w = Math.max(-1, Math.min(1, qErr.w)); // clamp
    let angle = 2 * Math.acos(w);
    if (angle > Math.PI) angle -= 2 * Math.PI; // wrap to (-pi, pi]
    const s = Math.sqrt(1 - w*w);
    let axis;
    if (s < 1e-8) {
      axis = new THREE.Vector3(1,0,0); // arbitrary axis when angle ~ 0
    } else {
      axis = new THREE.Vector3(qErr.x / s, qErr.y / s, qErr.z / s);
    }
    const z = [axis.x * angle, axis.y * angle, axis.z * angle]; // measurement vector (3)

    // Measurement matrix H (3x6) = [ I3  0 ]
    // We will use P11 (top-left 3x3) and P (6x6) to compute S and K efficiently.

    // S = H * P * H^T + R = P11 + R
    const P11 = BoneKalmanFilter.getBlock3(this.P, 0, 0);
    const S = BoneKalmanFilter.addMat3(P11, this.R);

    // invS (3x3)
    const invS = BoneKalmanFilter.invMat3(S);

    // PHt = P * H^T = first three columns of P (6x3) => extract columns 0..2
    const PHt = BoneKalmanFilter.extractLeftCols3(this.P); // 6x3

    // K = PHt * invS  (6x3) * (3x3) = 6x3
    const K = BoneKalmanFilter.mulMat6_3(PHt, invS);

    // delta_x = K * z  => 6x1
    const deltaX = BoneKalmanFilter.mulMat6Vec3(K, z);

    const deltaTheta = [deltaX[0], deltaX[1], deltaX[2]]; // 3
    const deltaB = [deltaX[3], deltaX[4], deltaX[5]];     // 3

    // Apply correction multiplicatively:
    // q_new = delta_quat(deltaTheta) * q_pred
    const deltaQcorr = BoneKalmanFilter.quatFromSmallAngle(deltaTheta);
    this.q.premultiply(deltaQcorr).normalize(); // left-multiply correction

    // b_new = b + delta_b
    this.b.add(new THREE.Vector3(deltaB[0], deltaB[1], deltaB[2]));

    // P = (I - K*H) * P
    // Compute KH (6x6) where H = [I3 0] so K*H = [K(:,0:2) * [I3;0]?? simpler: KH = K augmented to 6x6 with right cols zero]
    const KH = BoneKalmanFilter.zeroMat6();
    // KH top-left 3x3 = K(0:2,0:2) * I3? careful with indices: K is 6x3; KH = K * [I3 0] gives 6x6 where first 3 cols = K, last 3 cols = 0
    // Implement KH by setting left-3-columns of KH equal to K columns (for each of 3 columns), implemented as block
    BoneKalmanFilter.setLeftCols3(KH, K); // K is 6x3

    const I6 = BoneKalmanFilter.identity6();
    const IminusKH = BoneKalmanFilter.subMat6(I6, KH);
    this.P = BoneKalmanFilter.mulMat6(IminusKH, this.P);

    // Symmetrize P to avoid numerical drift
    this.P = BoneKalmanFilter.symmetrize6(this.P);
  }

  // ---------------------------
  // Static helper matrix/quaternion functions
  // Minimal implementations for 3x3 and 6x6 matrices using plain arrays.
  // 3x3: represented as nested array [[a,b,c],[d,e,f],[g,h,i]]
  // 6x6: represented similarly (array of 6 rows)
  // ---------------------------

  // Create zero 6x6
  static zeroMat6() {
    return Array.from({length:6}, () => Array(6).fill(0));
  }

  static identity6() {
    const M = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) M[i][i]=1;
    return M;
  }

  static identity3() {
    return [[1,0,0],[0,1,0],[0,0,1]];
  }

  static addMat3(A,B) {
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) C[i][j]=A[i][j]+B[i][j];
    return C;
  }

  static subMat6(A,B) {
    const C = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) for (let j=0;j<6;j++) C[i][j]=A[i][j]-B[i][j];
    return C;
  }

  static addMat6(A,B) {
    const C = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) for (let j=0;j<6;j++) C[i][j]=A[i][j]+B[i][j];
    return C;
  }

  // Multiply two 6x6 matrices
  static mulMat6(A,B) {
    const C = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) {
      for (let k=0;k<6;k++) {
        const aik = A[i][k];
        if (aik===0) continue;
        for (let j=0;j<6;j++) {
          C[i][j] += aik * B[k][j];
        }
      }
    }
    return C;
  }

  // Multiply 6x6 by 6x3? Not used. Instead helper below.

  // Transpose 6x6
  static transpose6(A) {
    const T = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) for (let j=0;j<6;j++) T[j][i]=A[i][j];
    return T;
  }

  // scale 3x3
  static scaleMat3(A, s) {
    const C = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) C[i][j]=A[i][j]*s;
    return C;
  }

  // set a 3x3 block into 6x6 at (row,col) where row,col are 0 or 3
  static setBlock3(M6, row, col, B3) {
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) M6[row+i][col+j] = B3[i][j];
  }

  static getBlock3(M6, row, col) {
    const B = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) B[i][j] = M6[row+i][col+j];
    return B;
  }

  // multiply 6x6 matrix by 3x3 (but we need specific shapes). We'll implement:
  // mulMat6_3(A6x3, B3x3) => 6x3
  static mulMat6_3(A, B) {
    // A: 6x3 (array of 6 rows with 3 cols)
    // B: 3x3
    const C = Array.from({length:6}, () => Array(3).fill(0));
    for (let i=0;i<6;i++) {
      for (let k=0;k<3;k++) {
        const aik = A[i][k];
        if (aik===0) continue;
        for (let j=0;j<3;j++) {
          C[i][j] += aik * B[k][j];
        }
      }
    }
    return C;
  }

  // multiply 6x3 by 3x1 vector -> 6x1
  static mulMat6Vec3(M6x3, v3) {
    const out = Array(6).fill(0);
    for (let i=0;i<6;i++) {
      let s = 0;
      for (let j=0;j<3;j++) s += M6x3[i][j] * v3[j];
      out[i] = s;
    }
    return out;
  }

  // Extract left 3 columns of 6x6 matrix (6x3)
  static extractLeftCols3(M6) {
    const out = Array.from({length:6}, () => Array(3).fill(0));
    for (let i=0;i<6;i++) for (let j=0;j<3;j++) out[i][j] = M6[i][j];
    return out;
  }

  // set left 3 columns of a 6x6 to a given 6x3 matrix
  static setLeftCols3(M6, A6x3) {
    for (let i=0;i<6;i++) for (let j=0;j<3;j++) M6[i][j] = A6x3[i][j];
  }

  // multiply 6x3 by 3x3 inverse etc we already have helpers above

  // 3x3 inverse
  static invMat3(A) {
    const a=A[0][0], b=A[0][1], c=A[0][2];
    const d=A[1][0], e=A[1][1], f=A[1][2];
    const g=A[2][0], h=A[2][1], i=A[2][2];
    const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
    if (Math.abs(det) < 1e-12) {
      // nearly singular — return pseudo-inverse approx (scaled identity)
      const s = 1e6;
      return BoneKalmanFilter.scaleMat3(BoneKalmanFilter.identity3(), s);
    }
    const invDet = 1.0 / det;
    const inv = [
      [(e*i - f*h)*invDet, (c*h - b*i)*invDet, (b*f - c*e)*invDet],
      [(f*g - d*i)*invDet, (a*i - c*g)*invDet, (c*d - a*f)*invDet],
      [(d*h - e*g)*invDet, (b*g - a*h)*invDet, (a*e - b*d)*invDet]
    ];
    return inv;
  }

  // Multiply 6x3 by 3x3 giving 6x3 (reuse mulMat6_3 with A=6x3, B=3x3)
  // (already implemented as mulMat6_3)

  // Multiply 6x3 by 3x3 then maybe used above

  // Symmetrize 6x6: (M + M^T)/2
  static symmetrize6(M) {
    const S = BoneKalmanFilter.zeroMat6();
    for (let i=0;i<6;i++) for (let j=0;j<6;j++) S[i][j] = 0.5*(M[i][j] + M[j][i]);
    return S;
  }

  // Quaternion from angular velocity (omega vector rad/s) and dt
  // returns quaternion representing rotation exp(0.5*omega*dt) to right-multiply state
  static quatFromOmega(omegaVec, dt) {
    // rotation vector = omega * dt
    const v = new THREE.Vector3().copy(omegaVec).multiplyScalar(dt);
    const angle = v.length();
    if (angle < 1e-12) return new THREE.Quaternion(0,0,0,1); // identity
    const axis = v.clone().normalize();
    const half = 0.5 * angle;
    const s = Math.sin(half);
    return new THREE.Quaternion(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
  }

  // Quaternion from small-angle vector deltaTheta (3)
  // returns quaternion ≈ [cos(|θ|/2), axis*sin(|θ|/2)]
  static quatFromSmallAngle(deltaTheta) {
    const vx = deltaTheta[0], vy = deltaTheta[1], vz = deltaTheta[2];
    const angle = Math.sqrt(vx*vx + vy*vy + vz*vz);
    if (angle < 1e-12) return new THREE.Quaternion(0,0,0,1);
    const axis = new THREE.Vector3(vx/angle, vy/angle, vz/angle);
    const half = 0.5 * angle;
    const s = Math.sin(half);
    return new THREE.Quaternion(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
  }

  // skew symmetric matrix from vector (3x3)
  static skew(v) {
    return [
      [  0,   -v.z,  v.y],
      [ v.z,   0,   -v.x],
      [-v.y,  v.x,   0  ]
    ];
  }
}

export { BoneKalmanFilter }



/**
 * Estima la velocidad angular a partir de las últimas rotaciones del buffer
 * @param {THREE.Quaternion[]} rotBuffer - Buffer de rotaciones (mínimo 2)
 * @param {number} dt - Diferencia de tiempo entre frames (segundos)
 * @returns {THREE.Vector3} Vector ω = (wx, wy, wz) en rad/s
 */
export function estimateOmegaFromBuffer(rotBuffer, dt) {
  const n = rotBuffer.length;
  if (n < 2 || dt <= 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  const qPrev = rotBuffer[n - 2];
  const qLast = rotBuffer[n - 1];

  // Rotación incremental: qΔ = q_prev^-1 * q_last
  const qDelta = qPrev.clone().invert().multiply(qLast).normalize();

  // Convertir qDelta → axis-angle
  let angle = 2 * Math.acos(THREE.MathUtils.clamp(qDelta.w, -1, 1));

  // Asegurar ángulo mínimo y dirección correcta
  if (angle > Math.PI) angle -= 2 * Math.PI;

  const s = Math.sqrt(1 - qDelta.w * qDelta.w);

  let axis = new THREE.Vector3();

  if (s < 1e-6) {
    // Si s ≈ 0 → rotación muy pequeña → axis arbitrario
    axis.set(1, 0, 0);
  } else {
    axis.set(
      qDelta.x / s,
      qDelta.y / s,
      qDelta.z / s
    );
  }

  // ω = axis * (angle / dt)
  const omega = axis.multiplyScalar(angle / dt);

  return omega;
}


// OneEuroFilter per a valors scalars
class OneEuroFilter {
    constructor(freq = 60, minCutoff = 1.0, beta = 0.001, dCutoff = 1.0) {
        this.freq = freq;          // Hz
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.xPrev = null;
        this.dxPrev = 0;
        this.lastTime = null;
    }

    alpha(cutoff) {
        const te = 1.0 / this.freq;
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / te);
    }

    filter(x,  dt = 0) {
        
        this.freq = 1.0 / dt;
        if (this.xPrev === null) {
            this.xPrev = x;
            return x;
        }

        const dx = (x - this.xPrev) * this.freq;
        const alphaD = this.alpha(this.dCutoff);
        const dxHat = alphaD * dx + (1 - alphaD) * this.dxPrev;

        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const alpha = this.alpha(cutoff);

        const xHat = alpha * x + (1 - alpha) * this.xPrev;

        this.xPrev = xHat;
        this.dxPrev = dxHat;

        return xHat;
    }
}

// Wrapper per a quaternions (slerp per suavitzar)
class QuaternionOneEuroFilter {
    constructor(freq = 60, minCutoff = 1.0, beta = 0.001, dCutoff = 1.0) {
        this.qPrev = null;
        this.filters = [
            new OneEuroFilter(freq, minCutoff, beta, dCutoff), // x
            new OneEuroFilter(freq, minCutoff, beta, dCutoff), // y
            new OneEuroFilter(freq, minCutoff, beta, dCutoff), // z
            new OneEuroFilter(freq, minCutoff, beta, dCutoff)  // w
        ];
    }

    filter(q, dt = null) {
        if (!this.qPrev) {
            this.qPrev = q.clone();
            return q.clone();
        }

        // Suavitza cada component
        const x = this.filters[0].filter(q.x, dt);
        const y = this.filters[1].filter(q.y, dt);
        const z = this.filters[2].filter(q.z, dt);
        const w = this.filters[3].filter(q.w, dt);

        const qFiltered = new THREE.Quaternion(x, y, z, w).normalize();

        // Opcional: slerp per suavitzar encara més respecte al frame anterior
        qFiltered.slerp(this.qPrev, 0.1);

        this.qPrev.copy(qFiltered);
        return qFiltered;
    }
}

export { QuaternionOneEuroFilter }