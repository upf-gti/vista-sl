import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationRetargeting } from './retargeting.js'

function getTwistQuaternion( q, normAxis, outTwist ){
    let dot =  q.x * normAxis.x + q.y * normAxis.y + q.z * normAxis.z;
    outTwist.set( dot * normAxis.x, dot * normAxis.y, dot * normAxis.z, q.w )
    outTwist.normalize(); // already manages (0,0,0,0) quaternions by setting identity
    return outTwist;
}

function findIndexOfBone( skeleton, bone ){
    if ( !bone ){ return -1;}
    let b = skeleton.bones;
    for( let i = 0; i < b.length; ++i ){
        if ( b[i] == bone ){ return i; }
    }
    return -1;
}

// sets bind quaternions only. Warning: Not the best function to call every frame.
function forceBindPoseQuats( skeleton, skipRoot = false ){
    let bones = skeleton.bones;
    let inverses = skeleton.boneInverses;
    if ( inverses.length < 1 ){ return; }
    let boneMat = inverses[0].clone(); 
    let _ignoreVec3 = new THREE.Vector3();
    for( let i = 0; i < bones.length; ++i ){
        boneMat.copy( inverses[i] ); // World to Local
        boneMat.invert(); // Local to World

        // get only the local matrix of the bone (root should not need any change)
        let parentIdx = findIndexOfBone( skeleton, bones[i].parent );
        if ( parentIdx > -1 ){ boneMat.premultiply( inverses[ parentIdx ] ); }
        else{
            if ( skipRoot ){ continue; }
        }
       
        boneMat.decompose( _ignoreVec3, bones[i].quaternion, _ignoreVec3 );
        // bones[i].quaternion.setFromRotationMatrix( boneMat );
        bones[i].quaternion.normalize(); 
    }
}

class Visualizer {
    constructor() {

        this.elapsedTime = 0; // clock is ok but might need more time control to dinamicaly change signing speed
        this.clock = new THREE.Clock();

        this.BVHloader = new BVHLoader();
        this.GLTFloader = new GLTFLoader();
        this.mixer = null;
        this.retargeting = null; //new AnimationRetargeting();
        this.model = null;


        this.pointCloudGroup = null;
        this.bodyPoints = [];
        this.leftHandPoints = [];
        this.rightHandPoints = [];
        this.bodyLines = [];
        this.leftHandLines = [];
        this.rightHandLines = [];

        this.bodyLineSegments = null;
        this.leftHandLineSegments = null;
        this.rightHandLineSegments = null;

    }

    async init( scene, character, POSE_CONNECTIONS, HAND_CONNECTIONS ) {
        this.scene = scene;
        // load model
         return new Promise((resolve) => {
            this.BVHloader.load( 'kateBVH.bvh', (result) =>{
                result.skeleton.bones.forEach( b => { b.name = b.name.replace( /[`~!@#$%^&*()_|+\-=?;:'"<>\{\}\\\/]/gi, "") } );
                // loader does not correctly compute the skeleton boneInverses and matrixWorld 
                result.skeleton.bones[0].updateWorldMatrix( false, true ); // assume 0 is root
                result.skeleton = new THREE.Skeleton( result.skeleton.bones ); // will automatically compute boneInverses
                result.skeleton.pose();
                result.skeleton.bones[0].scale.set(0.01, 0.01, 0.01);

                this.bvh = result;
                this.bvh.mixer = new THREE.AnimationMixer(result.skeleton.bones[0]);
                this.bvh.skeletonHelper = new THREE.SkeletonHelper(result.skeleton.bones[0]);

                scene.add(result.skeleton.bones[0]);
                scene.add(this.bvh.skeletonHelper);
                this.loadAvatar(character);
                resolve();
            });

            this.pointCloudGroup = new THREE.Object3D();
            this.pointCloudGroup.position.set(0,0.9,-0.05);

            this.scene.add( this.pointCloudGroup );
            const geometry = new THREE.SphereGeometry(0.005, 16, 16);
            
            let material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            for( let i = 0; i< 33; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.bodyPoints.push(g)
            }
            
            material = new THREE.MeshBasicMaterial({ color: 0x0000ff });
            for( let i = 0; i< 21; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.leftHandPoints.push(g)
            }  
            
            material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
            for( let i = 0; i< 21; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.rightHandPoints.push(g)
            }


            // POSE_CONNECTIONS & HAND_CONNECTIONS come from mediapipe drawutils import
            let lineMaterial = new THREE.LineBasicMaterial( { color: 0xff0000 } );
            const points = [ new THREE.Vector3(0,0,0), new THREE.Vector3(1,1,1) ];
            for( let i = 0; i < POSE_CONNECTIONS.length; ++i ){
                const lineGeometry = new THREE.BufferGeometry().setFromPoints( points );
                let line = new THREE.Line( lineGeometry, lineMaterial );
                this.bodyLines.push( line );
                this.pointCloudGroup.add( line );
            }
            
            let lineMaterialRight = new THREE.LineBasicMaterial( { color: 0x00ff00 } );
            let lineMaterialLeft = new THREE.LineBasicMaterial( { color: 0x0000ff } );
            for( let i = 0; i < HAND_CONNECTIONS.length; ++i ){
                let lineGeometry = new THREE.BufferGeometry().setFromPoints( points );
                let line = new THREE.Line( lineGeometry, lineMaterialRight );
                this.rightHandLines.push( line );
                this.pointCloudGroup.add( line );
                lineGeometry = new THREE.BufferGeometry().setFromPoints( points );
                line = new THREE.Line( lineGeometry, lineMaterialLeft );
                this.leftHandLines.push( line );
                this.pointCloudGroup.add( line );
            }
        });
    }

    loadAvatar( character ) {
                    
            this.skeletonHelper = new THREE.SkeletonHelper(character.model);
            this.skeletonHelper.name = "SkeletonHelper";

            this.model = character.model;
            this.skeleton = character.skeleton;
            //Create animations
            this.mixer = new THREE.AnimationMixer(this.model);
            this.retargeting = new AnimationRetargeting( this.bvh.skeleton, this.skeleton, { trgUseCurrentPose: true, srcEmbedWorldTransforms: true } );
            // guizmo stuff
          
            this.scene.add( this.skeletonHelper );
            this.animation = null;
      
    }
    
    animate() {

        let delta = this.clock.getDelta()         
        this.elapsedTime += delta;

        forceBindPoseQuats( this.skeleton, false );

        if( this.bodyPoints.length ){
            this.computeSpine( this.skeleton, this.bodyPoints );
            this.computeQuatHead( this.skeleton, this.bodyPoints )
        }
        if ( this.rightHandPoints.length ){ 
            this.computeQuatArm( this.skeleton, this.bodyPoints, false );
            this.computeQuatHand( this.skeleton, this.rightHandPoints, false); 
            this.computeQuatPhalange( this.skeleton, this.rightHandPoints, false );
        }
        if ( this.leftHandPoints.length ){
            this.computeQuatArm( this.skeleton, this.bodyPoints, true );
            this.computeQuatHand( this.skeleton, this.leftHandPoints, true); 
            this.computeQuatPhalange( this.skeleton, this.leftHandPoints, true );
        }

    }

    computeSpine( skeleton, bodyLandmarks ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)

        const boneHips = skeleton.bones[ 0 ];
        const boneSpine0 = skeleton.bones[ 1 ]; // connected to hips
        const boneSpine1 = skeleton.bones[ 2 ];
        const boneSpine2 = skeleton.bones[ 3 ];
        const boneLeftLeg = skeleton.bones[ 57 ]; // connected to hips
        const boneRightLeg = skeleton.bones[ 62 ]; // connected to hips


        boneHips.updateWorldMatrix( true, true );

        const landmarkHipsLeft = bodyLandmarks[ 23 ].position;
        const landmarkHipsRight = bodyLandmarks[ 24 ].position;
        const landmarkShoulderLeft = bodyLandmarks[ 11 ].position;
        const landmarkShoulderRight = bodyLandmarks[ 12 ].position;
        const landmarkHipsMid = new THREE.Vector3(0,0,0);
        const landmarkShoulderMid = new THREE.Vector3(0,0,0);
        let dirHipsPred = ( new THREE.Vector3() ).subVectors( landmarkHipsRight, landmarkHipsLeft ); 
        let dirShoulderPred = ( new THREE.Vector3() ).subVectors( landmarkShoulderRight, landmarkShoulderLeft ); 
        landmarkHipsMid.addScaledVector( dirHipsPred, 0.5).add( landmarkHipsLeft );
        landmarkShoulderMid.addScaledVector( dirShoulderPred, 0.5).add( landmarkShoulderLeft );
        let dirSpinePred = ( new THREE.Vector3() ).subVectors( landmarkShoulderMid, landmarkHipsMid ).normalize();

        const dirBone = new THREE.Vector3();
        const _ignoreVec3 = new THREE.Vector3();
        const invWorldQuat = new THREE.Quaternion();
        const qq = new THREE.Quaternion();
        const tempQuat = new THREE.Quaternion();
        
        // hips
        boneHips.matrixWorld.decompose( _ignoreVec3, invWorldQuat, _ignoreVec3 );
        invWorldQuat.invert();

        dirHipsPred.applyQuaternion( invWorldQuat ).normalize(); // world direction to local hips space
        dirBone.subVectors( boneRightLeg.position, boneLeftLeg.position ).normalize(); // Local hips space
        qq.setFromUnitVectors( dirBone, dirHipsPred ).normalize();
        let twist = getTwistQuaternion( qq, dirBone, tempQuat ); // remove unwanted roll forward/backward
        qq.multiply( twist.invert() );
        boneHips.quaternion.multiply( qq );
        invWorldQuat.premultiply( qq.invert() );

        // spine
        dirSpinePred.applyQuaternion( invWorldQuat ); // world direction to local hips space
        boneSpine2.updateWorldMatrix( true, false );
        dirBone.setFromMatrixPosition( boneSpine2.matrixWorld ); // world position of shoulders union
        dirBone.applyMatrix4( boneHips.matrixWorld.clone().invert() ); //world position to local direction hips space
        qq.setFromUnitVectors( dirBone, dirSpinePred ).normalize();
        // divide final rotation into for offset (one for each hips-spine bone) (nlerp with identityQuat)
        let f= 1.0/4.0;
        qq.x = qq.x * f;
        qq.y = qq.y * f;
        qq.z = qq.z * f;
        qq.w = qq.w * f + 1 * (1-f);
        qq.normalize();
        boneHips.quaternion.multiply(qq);

        // move qq from left_spine0_Quat to right_spine_Quat.  
        // Q = (hips * qq) * spine0Quat = hips * (qq * spine0Quat) = hips * spine0Quat * qq'
        qq.multiply( boneSpine0.quaternion ).premultiply( tempQuat.copy( boneSpine0.quaternion ).invert() );
        boneSpine0.quaternion.multiply( qq );

        // Q = (spine0Quat * qq') * spine1Quat = spine0Quat * (qq' * spine1Quat) = spine0Quat * spine1Quat * qq''
        qq.multiply( boneSpine1.quaternion ).premultiply( tempQuat.copy( boneSpine1.quaternion ).invert() );
        boneSpine1.quaternion.multiply( qq );

        // // Q = (spine1Quat * qq'') * spine2Quat = spine1Quat * (qq'' * spine2Quat) = spine1Quat * spine2Quat * qq'''
        // qq.multiply( boneSpine2.quaternion ).premultiply( tempQuat.copy( boneSpine2.quaternion ).invert() );
        // boneSpine2.quaternion.multiply( qq );
        boneSpine2.quaternion.premultiply( qq );
    }

    computeQuatHead( skeleton, bodyLandmarks ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)

        let tempVec3 = new THREE.Vector3();
        let qq = new THREE.Quaternion();

        const boneHead = skeleton.bones[ 5 ]; // head
        let boneHeadTop = boneHead; // head top, must be a children of head
        for(let i = 0; i < boneHead.children.length; i++) {
            if(boneHead.children[i].name.toLowerCase().includes('eye')) {
                continue;
            }
            boneHeadTop = boneHead.children[i];
            break;
        }
        boneHead.updateWorldMatrix( true, false );
        // character bone local space direction
        let headBoneDir = boneHeadTop.position.clone().normalize();

        // world space
        let earsDirPred = (new THREE.Vector3()).subVectors( bodyLandmarks[8].position, bodyLandmarks[7].position ).normalize();
        let earNoseDirPred = (new THREE.Vector3()).subVectors( bodyLandmarks[0].position, bodyLandmarks[7].position ).normalize();
        let upHeadDirPred = (new THREE.Vector3()).crossVectors( earsDirPred, earNoseDirPred ).normalize(); // will change to local
        let forwardHeadDirPred = (new THREE.Vector3()).crossVectors( upHeadDirPred, earsDirPred ).normalize();
        
        boneHead.matrixWorld.decompose( tempVec3, qq, tempVec3 );
        qq.invert(); // invWorldQuat
        upHeadDirPred.applyQuaternion( qq ).normalize(); // local space
    
        // move head to predicted direction (SWING)
        qq.setFromUnitVectors( headBoneDir, upHeadDirPred );
        boneHead.quaternion.multiply( qq )
        getTwistQuaternion( qq, headBoneDir, qq ); // unwanted twist from the swing operation
        boneHead.quaternion.multiply( qq.invert() ).normalize(); // remove twist
        
        // compute head roll (TWIST)
        tempVec3.set(-1,0,0); // because of mediapipe points
        let angle = Math.acos( forwardHeadDirPred.dot( tempVec3 ) ); // computing in world space
        angle -= Math.PI/2;
        qq.setFromAxisAngle( headBoneDir, angle ); // angle does not which space is in
        boneHead.quaternion.multiply( qq ).normalize();
    }

    computeQuatArm( skeleton, bodyLandmarks, isLeft = false ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)

        let landmarks = isLeft? [ 11,13,15 ] : [ 12,14,16 ];
        let boneIdxs = isLeft? [ 10,11,12 ] : [ 34,35,36 ]; // [arm, elbow, wrist]

        let _ignoreVec3 = new THREE.Vector3();
        let invWorldQuat = new THREE.Quaternion();
        let dirPred = new THREE.Vector3();
        let dirBone = new THREE.Vector3();
        let qq = new THREE.Quaternion();
        let twist = new THREE.Quaternion();

        for( let i = 0; i < (landmarks.length-1); ++i ){
            let boneSrc = skeleton.bones[ boneIdxs[ i ] ];
            let boneTrg = skeleton.bones[ boneIdxs[ i+1 ] ];
            let landmarkSrc = bodyLandmarks[ landmarks[i] ].position;
            let landmarkTrg = bodyLandmarks[ landmarks[i+1] ].position;
            boneSrc.updateWorldMatrix( true, false );

            boneSrc.matrixWorld.decompose( _ignoreVec3, invWorldQuat, _ignoreVec3 );
            invWorldQuat.invert();

            // world mediapipe bone direction to local space
            dirPred.subVectors( landmarkTrg, landmarkSrc );
            dirPred.applyQuaternion( invWorldQuat ).normalize();

            // character bone local space direction
            dirBone.copy( boneTrg.position ).normalize();

            // move bone to predicted direction
            qq.setFromUnitVectors( dirBone, dirPred );
            boneSrc.quaternion.multiply( qq );
            getTwistQuaternion( qq, dirBone, twist ); // remove undesired twist from bone
            boneSrc.quaternion.multiply( twist.invert() ).normalize();
        }
    }

    computeQuatHand( skeleton, handLandmarks, isLeft = false ){
        if ( !handLandmarks ){ return; }
        //handlandmarks is an array of {x,y,z,visiblity} (mediapipe)

        const boneHand = isLeft? skeleton.bones[ 12 ] : skeleton.bones[ 36 ];
        const boneMid = isLeft? skeleton.bones[ 21 ] : skeleton.bones[ 45 ];
        // const boneThumbd = isLeft? skeleton.bones[ 13 ] : skeleton.bones[ 53 ];
        const bonePinky = isLeft? skeleton.bones[ 29 ] : skeleton.bones[ 37 ];
        const boneIndex = isLeft? skeleton.bones[ 17 ] : skeleton.bones[ 49 ];

        boneHand.updateWorldMatrix( true, false );

        let _ignoreVec3 = new THREE.Vector3();
        let invWorldQuat = new THREE.Quaternion();
        boneHand.matrixWorld.decompose( _ignoreVec3, invWorldQuat, _ignoreVec3 ); // get L to W quat
        invWorldQuat.invert(); // W to L

        // metacarpian middle finger 
        let mcMidPred = new THREE.Vector3(); 
        mcMidPred.subVectors( handLandmarks[9].position, handLandmarks[0].position ); // world
        mcMidPred.applyQuaternion( invWorldQuat ).normalize(); // hand local space
        
        //swing (with unwanted twist)
        let dirBone = boneMid.position.clone().normalize();
        let qq = new THREE.Quaternion();
        qq.setFromUnitVectors( dirBone, mcMidPred );
        boneHand.quaternion.multiply( qq );
        invWorldQuat.premultiply( qq.invert() ); // update hand's world to local quat

        // twist
        let mcPinkyPred = (new THREE.Vector3()).subVectors( handLandmarks[17].position, handLandmarks[0].position );
        let mcIndexPred = (new THREE.Vector3()).subVectors( handLandmarks[5].position, handLandmarks[0].position );
        let palmDirPred = (new THREE.Vector3()).crossVectors(mcPinkyPred, mcIndexPred).normalize(); // world space
        palmDirPred.applyQuaternion( invWorldQuat ).normalize(); // local space
        let palmDirBone = (new THREE.Vector3()).crossVectors(bonePinky.position, boneIndex.position).normalize(); // local space. Cross product "does not care" about input sizes
        qq.setFromUnitVectors( palmDirBone, palmDirPred ).normalize();
        boneHand.quaternion.multiply( qq ).normalize();
        //console.log(boneHand.rotation._x*180/Math.PI, boneHand.rotation._y*180/Math.PI, boneHand.rotation._z*180/Math.PI)
    }

    computeQuatPhalange( skeleton, handLandmarks, isLeft = false ){
        if ( !handLandmarks ){ return; }
        //handlandmarks is an array of {x,y,z,visiblity} (mediapipe)

        const bonePhalanges = isLeft ? 
        [ 13,14,15,16,    17,18,19,20,    21,22,23,24,    25,26,27,28,    29,30,31,32 ] :
        [ 53,54,55,56,    49,50,51,52,    45,46,47,48,    41,42,43,44,    37,38,39,40 ];

        let tempVec3_1 = new THREE.Vector3();
        let tempVec3_2 = new THREE.Vector3();
        const invWorldQuat = new THREE.Quaternion();

        tempVec3_1.subVectors(handLandmarks[5].position, handLandmarks[0].position).normalize();
        tempVec3_2.subVectors(handLandmarks[17].position, handLandmarks[0].position).normalize();
        const handForward = (new THREE.Vector3()).addScaledVector(tempVec3_1,0.5).addScaledVector(tempVec3_2,0.5); // direction of fingers
        const handNormal = (new THREE.Vector3()).crossVectors(tempVec3_2,tempVec3_1).normalize(); // on right hand and left hand, direction from back of hand outwards
        const handSide = (new THREE.Vector3()).crossVectors(handNormal,handForward).normalize(); // on right hand, direction from center of hand to thumb side. On left hand, direction form center of hand to pinky side
        if ( isLeft ){
            handNormal.multiplyScalar(-1);
            handSide.multiplyScalar(-1);
        }

        const prevForward = new THREE.Vector3();
        const prevNormal = new THREE.Vector3();
        const prevSide = new THREE.Vector3();

        const maxLateralDeviation = Math.cos(60 * Math.PI/180);
        const latDevQuat = new THREE.Quaternion();
        const latDevNormal = new THREE.Vector3();

        // for each finger (and thumb)
        for( let f = 1; f < handLandmarks.length; f+=4){

            // fingers can slightly move laterally. Compute the mean lateral movement of the finger
            let meanSideDeviation = 0;
            tempVec3_1.subVectors(handLandmarks[f+1].position, handLandmarks[f+0].position).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            const fingerBend = handNormal.dot(tempVec3_1);
            tempVec3_1.subVectors(handLandmarks[f+2].position, handLandmarks[f+1].position).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            tempVec3_1.subVectors(handLandmarks[f+3].position, handLandmarks[f+2].position).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            
            if (Math.abs(meanSideDeviation) > maxLateralDeviation){
                meanSideDeviation = (meanSideDeviation < 0) ? -maxLateralDeviation : maxLateralDeviation;
            }
            if ( fingerBend < 0){ // the more the finger is bended, the less it can be moved sideways
                meanSideDeviation *= 1+fingerBend;
            }
            // end of lateral computations

            // phalanges can bend. Thus, reference vectors need to be with respect to the last phalange (or the base of the hand)
            prevForward.copy(handForward);
            prevSide.copy(handSide);
            prevNormal.copy(handNormal);

            // for each phalange of each finger (and thumb)
            for( let i = 0; i < 3; ++i){
                const boneSrc = skeleton.bones[ bonePhalanges[ f + i-1 ] ];
                const boneTrg = skeleton.bones[ bonePhalanges[ f + i ] ];
                const landmark = f + i;
                boneSrc.updateWorldMatrix( true, false );
            
                // world mediapipe phalange direction
                let v_phalange = new THREE.Vector3();
                v_phalange.subVectors( handLandmarks[landmark+1].position, handLandmarks[landmark].position ).normalize();

                // fingers (no thumb). All lateral deviation is removed and added later on
                if ( f > 4 ){
                    // remove all lateral deviation (later will add the allowed one)
                    v_phalange.addScaledVector(handSide, -v_phalange.dot(handSide));
                    if (v_phalange.length() < 0.0001 ){
                        v_phalange.copy(prevForward);
                    }else{
                        v_phalange.normalize();
                    }

                    // prevForward and prevNormal do not have any lateral deviation
                    const dotForward = v_phalange.dot(prevForward);
                    const dotNormal = v_phalange.dot(prevNormal);
                    
                    // finger cannot bend uppwards
                    if (dotNormal > 0){
                        v_phalange.copy( prevForward );
                    }else{
                        const limitForward = -0.76; // cos 40º
                        const limitNormal = -0.64; // sin 40º
                        // too much bending, restrict it (set default bended direction)
                        if ( dotForward < limitForward ){ 
                            v_phalange.set(0,0,0);
                            v_phalange.addScaledVector( prevForward, limitForward);
                            v_phalange.addScaledVector( prevNormal, limitNormal);
                        }
                    }
    
                    v_phalange.normalize();
            
                    prevNormal.crossVectors( v_phalange, handSide ).normalize();
                    prevForward.copy(v_phalange); // without any lateral deviation

                    // store lateral deviation rotation axis. As the finger could be bent, the fingerNormal and handNormal do not necessarily match. 
                    if ( i == 0 ){
                        latDevNormal.copy( prevNormal );
                    }
                }
                else {
                    // thumb
                    if (i==0){
                        // base of thumb
                        const dotthumb = v_phalange.dot(handNormal);
                        const mint = -0.45;
                        const maxt = 0.0;
                        if ( dotthumb > maxt || dotthumb < mint ){
                            const clampDot = Math.max(mint, Math.min(maxt, dotthumb));
                            v_phalange.addScaledVector(handNormal, -dotthumb + clampDot);
                        }
                        prevForward.copy(handForward);
                        prevSide.copy(handNormal); // swap
                        prevNormal.copy(handSide); // swap
                        if ( isLeft ){
                            prevNormal.multiplyScalar(-1);                            
                        }
                    }
                    else{
                        // other thumb bones
                        // remove lateral deviation
                        v_phalange.addScaledVector(prevSide, -v_phalange.dot(prevSide));
                        
                        // cannot bend on that direction
                        const dotNormal = v_phalange.dot(prevNormal);
                        if (dotNormal > 0){
                            v_phalange.addScaledVector(prevNormal, -dotNormal)
                        }        
                    }

                    v_phalange.normalize();
    
                    if (v_phalange.length() < 0.0001 ){
                        v_phalange.copy(prevForward);
                    }
    
                    // update previous directions with the current ones
                    if ( isLeft ){
                        prevNormal.crossVectors( v_phalange, prevSide ).normalize();
                        prevSide.crossVectors( prevNormal, v_phalange ).normalize();
                        prevForward.copy(v_phalange);
                    }else{
                        prevNormal.crossVectors( prevSide, v_phalange ).normalize();
                        prevSide.crossVectors( v_phalange, prevNormal ).normalize();
                        prevForward.copy(v_phalange);
                    }
                }


                boneSrc.matrixWorld.decompose( tempVec3_1, invWorldQuat, tempVec3_1 );
                invWorldQuat.invert();
                // world phalange direction to local space
                v_phalange.applyQuaternion( invWorldQuat ).normalize();
    
                // character bone local space direction
                let phalange_p = boneTrg.position.clone().normalize();
    
                // move bone to predicted direction
                const rot = new THREE.Quaternion();
                const twist = new THREE.Quaternion();
                rot.setFromUnitVectors( phalange_p, v_phalange );
                getTwistQuaternion( rot, phalange_p, twist ); // remove undesired twist from phalanges
                boneSrc.quaternion.multiply( rot ).multiply( twist.invert() ).normalize();
            }// end of phalange for

            // add lateral deviation for fingers, only on the base bone. Right now, fingers are all in the plane ( Normal x Forward )
            if( f > 4 ){
                const boneSrc = skeleton.bones[ bonePhalanges[ f-1 ] ];
                boneSrc.updateMatrixWorld(true);
                let q = new THREE.Quaternion();
                boneSrc.matrixWorld.decompose(tempVec3_1, q, tempVec3_1);
                latDevNormal.applyQuaternion( q.invert() );
                latDevQuat.setFromAxisAngle( latDevNormal, (Math.PI-Math.acos(meanSideDeviation)) - Math.PI*0.5);
                boneSrc.quaternion.multiply(latDevQuat);
            }
        } // end of finger 'for'
    };

    loadAnimationWithSkin(bvhAnimation) {
        let skeletonAnim = this.bvh;

        if(!skeletonAnim || !skeletonAnim.skeleton ) {
            return;
        }
        
        let tracks = [];
        // remove position changes (only keep i == 0, hips)
        for (let i = 0; i < bvhAnimation.tracks.length; i++) {
            if(i && bvhAnimation.tracks[i].name.includes('position')) {
                continue;
            }
            tracks.push( bvhAnimation.tracks[i] );
        }
        bvhAnimation.tracks = tracks;
        
        this.bvh.mixer.stopAllAction();
        if (this.bvh.animation) { this.bvh.mixer.uncacheClip(this.bvh.animation); }
        this.bvh.animation = bvhAnimation;
        this.bvh.mixer.clipAction(this.bvh.animation).setEffectiveWeight(1.0).play();
        this.bvh.mixer.setTime(0);
        this.bvh.skeleton.bones[0].position.x = 0.5;
        
        this.retargeting.retargetPose();
    }

    processDetections( detections, POSE_CONNECTIONS, HAND_CONNECTIONS  ){
        let a = this.bodyPoints;
        if (detections.retargetLandmarks) {
            detections.body.w[11].x -= 0.05; // left shoulder
            detections.body.w[11].y += 0.02; // left shoulder
            detections.body.w[12].x += 0.02; // right shoulder
            detections.body.w[12].y += 0.01; // right shoulder
        }

        for( let i = 0; i < detections.body.w.length; ++i ){
            let p = detections.body.w[i];
            this.bodyPoints[i].position.set( p.x, -p.y, -p.z );
        }

        let leftWrist = detections.leftHand.w[0];
        for( let i = 0; i < detections.leftHand.w.length; ++i ){
            let p = detections.leftHand.w[i];
            this.leftHandPoints[i].position.set( p.x - leftWrist.x, -( p.y - leftWrist.y ), -( p.z - leftWrist.z ) );
            this.leftHandPoints[i].position.add( this.bodyPoints[15].position );
        }

        let rightWrist = detections.rightHand.w[0];
        for( let i = 0; i < detections.rightHand.w.length; ++i ){
            let p = detections.rightHand.w[i];
            this.rightHandPoints[i].position.set( p.x - rightWrist.x, -( p.y - rightWrist.y ), -( p.z - rightWrist.z ) );
            this.rightHandPoints[i].position.add( this.bodyPoints[16].position );
        }

        for( let i = 0; i < POSE_CONNECTIONS.length; ++i ){
            let a = this.bodyPoints[ POSE_CONNECTIONS[i].start ].position;
            let b = this.bodyPoints[ POSE_CONNECTIONS[i].end ].position;
            this.bodyLines[i].geometry.setFromPoints( [ a,b ] );
        }
        for( let i = 0; i < HAND_CONNECTIONS.length; ++i ){
            let a = this.rightHandPoints[ HAND_CONNECTIONS[i].start ].position;
            let b = this.rightHandPoints[ HAND_CONNECTIONS[i].end ].position;
            this.rightHandLines[i].geometry.setFromPoints( [ a,b ] );
            a = this.leftHandPoints[ HAND_CONNECTIONS[i].start ].position;
            b = this.leftHandPoints[ HAND_CONNECTIONS[i].end ].position;
            this.leftHandLines[i].geometry.setFromPoints( [ a,b ] );
        }
    }
}

export {Visualizer}