import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationRetargeting, applyTPose } from './retargeting.js';

import { QuaternionOneEuroFilter } from './filter.js';

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
    constructor( frameCount ) {

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

        this.prevBodyLandmarks = [];
        this.prevLeftHandLandmarks = [];
        this.prevRightHandLandmarks = [];
        this.prevFaceBlendshapes = [];

        this.rotationHistory = {};
        this.smoothFrameCount = frameCount || 10;
        this.lambda = 100;
        this.p = 0.5;

        this.kf = {};
        this.smoothRotations = true;
        this.showSkeletons = false;
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
                // this.bvh.skeletonHelper.visible = false;
                scene.add(result.skeleton.bones[0]);
                scene.add(this.bvh.skeletonHelper);
                this.loadAvatar(character);
                resolve();
            });

            this.pointCloudGroup = new THREE.Object3D();
            this.pointCloudGroup.position.set(0,0.9,-0.05);
            this.pointCloudGroup.visible = false;

            this.scene.add( this.pointCloudGroup );
            const geometry = new THREE.SphereGeometry(0.005, 16, 16);
            
            let material = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false });
            for( let i = 0; i< 33; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.bodyPoints.push(g)
            }
            
            material = new THREE.MeshBasicMaterial({ color: 0x0000ff, depthTest: false });
            for( let i = 0; i< 21; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.leftHandPoints.push(g)
            }  
            
            material = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false });
            for( let i = 0; i< 21; ++i ){
                let g = new THREE.Mesh( geometry, material );
                this.pointCloudGroup.add(g)
                this.rightHandPoints.push(g)
            }


            // POSE_CONNECTIONS & HAND_CONNECTIONS come from mediapipe drawutils import
            let lineMaterial = new THREE.LineBasicMaterial( { color: 0xff0000, depthTest: false } );
            const points = [ new THREE.Vector3(0,0,0), new THREE.Vector3(1,1,1) ];
            for( let i = 0; i < POSE_CONNECTIONS.length; ++i ){
                const lineGeometry = new THREE.BufferGeometry().setFromPoints( points );
                let line = new THREE.Line( lineGeometry, lineMaterial );
                this.bodyLines.push( line );
                this.pointCloudGroup.add( line );
            }
            
            let lineMaterialRight = new THREE.LineBasicMaterial( { color: 0x00ff00, depthTest: false } );
            let lineMaterialLeft = new THREE.LineBasicMaterial( { color: 0x0000ff, depthTest: false } );
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
            this.skeletonHelper.visible = false;
            this.model = character.model;
            this.skeleton = character.skeleton;
            this.morphTargets = character.morphTargets;
            this.characterMap = character.config.faceController.blendshapeMap
            //Create animations
            this.mixer = new THREE.AnimationMixer(this.model);
            this.retargeting = new AnimationRetargeting( this.bvh.skeleton, this.skeleton, { trgUseCurrentPose: true, srcEmbedWorldTransforms: true } );
            // guizmo stuff
            this.scene.remove(this.scene.getObjectByName("SkeletonHelper"));
            this.scene.add( this.skeletonHelper );
            this.animation = null;
      
    }
    
    animate() {

        let delta = this.clock.getDelta()         
        this.elapsedTime += delta;

        forceBindPoseQuats( this.skeleton, false );
        this.createBodyPoseFromWorldLandmarks( this.skeleton, {
            PWLM: this.bodyPoints.length ? this.bodyPoints : null,
            RWLM: this.rightHandPoints.length ? this.rightHandPoints : null,
            LWLM: this.leftHandPoints.length ? this.leftHandPoints : null,
        }, delta );

    }

    changeVisibility() {
        this.pointCloudGroup.visible = !this.pointCloudGroup.visible;
        this.bvh.skeletonHelper.visible = !this.bvh.skeletonHelper.visible;
        this.skeletonHelper.visible = !this.skeletonHelper.visible;
    }

    smoothBoneQuaternion( bone, dt ){
        if(!this.kf[bone.name]) {
            this.kf[bone.name] = new QuaternionOneEuroFilter(60, 1.0, 0.001, 1.0);
        }

        const qFiltered = this.kf[bone.name].filter(bone.quaternion, dt);
        bone.quaternion.copy(qFiltered);

        // if (!this.rotationHistory[bone.name]) this.rotationHistory[bone.name] = [];
        // let history = this.rotationHistory[bone.name];
        // history.push(bone.quaternion.clone());
        // while (history.length >= this.smoothFrameCount) history.shift();
        // smoothedLocalRotation = this.smoothQuaternionsByJointLocal(history, this.lambda, this.p);
    }

    computeSpine( skeleton, bodyLandmarks, bindQuats = null, deltaTime = 0 ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)
    
        const boneHips = skeleton.bones[ 0 ];
        const boneSpine0 = skeleton.bones[ 1 ]; // connected to hips
        const boneSpine1 = skeleton.bones[ 2 ];
        const boneSpine2 = skeleton.bones[ 3 ];
        const boneLeftLeg = skeleton.bones[ 57 ]; // connected to hips
        const boneRightLeg = skeleton.bones[ 62 ]; // connected to hips
    
        if ( bindQuats ){    
            boneHips.quaternion.copy( bindQuats[ 0 ] );
            boneSpine0.quaternion.copy( bindQuats[ 1 ] );
            boneSpine1.quaternion.copy( bindQuats[ 2 ] );
            boneSpine2.quaternion.copy( bindQuats[ 3 ] );
        }
    
        boneHips.updateWorldMatrix( true, true );
    
        const landmarkHipsLeft = bodyLandmarks[ 23 ].position ?? bodyLandmarks[ 23 ];
        const landmarkHipsRight = bodyLandmarks[ 24 ].position ?? bodyLandmarks[ 24 ];
        const landmarkShoulderLeft = bodyLandmarks[ 11 ].position ?? bodyLandmarks[ 11 ];
        const landmarkShoulderRight = bodyLandmarks[ 12 ].position ?? bodyLandmarks[ 12 ];
    
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
        boneSpine2.quaternion.premultiply( qq );

        if( this.smoothRotations ){
            this.smoothBoneQuaternion( boneHips, deltaTime );
            this.smoothBoneQuaternion( boneSpine0, deltaTime );
            this.smoothBoneQuaternion( boneSpine1, deltaTime );
            this.smoothBoneQuaternion( boneSpine2, deltaTime );
        }
    }

    computeQuatHead( skeleton, bodyLandmarks, bindQuats = null, deltaTime = 0 ){
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
    
        if ( bindQuats ){
            boneHead.quaternion.copy( bindQuats[ 5 ] );
        }
    
        boneHead.updateWorldMatrix( true, false );
        // character bone local space direction
        let headBoneDir = boneHeadTop.position.clone().normalize();
    
        const landmarkNose = bodyLandmarks[0].position ?? bodyLandmarks[0];
        const landmarkEarLeft = bodyLandmarks[7].position ?? bodyLandmarks[7];
        const landmarkEarRight = bodyLandmarks[8].position ?? bodyLandmarks[8];
    
        // world space
        let earsDirPred = (new THREE.Vector3()).subVectors( landmarkEarRight, landmarkEarLeft ).normalize();
        let earNoseDirPred = (new THREE.Vector3()).subVectors( landmarkNose, landmarkEarLeft ).normalize();
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

        if( this.smoothRotations ){
            this.smoothBoneQuaternion( boneHead, deltaTime );
        }
    }
    
    computeQuatArm( skeleton, bodyLandmarks, isLeft = false, deltaTime = 0 ){
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
            const boneSrc = skeleton.bones[ boneIdxs[ i ] ];
            const boneTrg = skeleton.bones[ boneIdxs[ i+1 ] ];
            if( !boneSrc || !boneTrg) {
                continue;
            }
            const landmarkSrc = bodyLandmarks[ landmarks[i] ].position ?? bodyLandmarks[ landmarks[i] ] ;
            const landmarkTrg = bodyLandmarks[ landmarks[i+1] ].position ?? bodyLandmarks[ landmarks[i+1] ];
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

            if( this.smoothRotations ){
                this.smoothBoneQuaternion( boneSrc, deltaTime );
            }
        }
    }
    
    computeQuatHand( skeleton, handLandmarks, isLeft = false, deltaTime = 0 ){
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
    
        const landmarkWrist = handLandmarks[0].position ?? handLandmarks[0];
        const landmarkMCIndex = handLandmarks[5].position ?? handLandmarks[5];
        const landmarkMCMiddle = handLandmarks[9].position ?? handLandmarks[9];
        const landmarkMCPinky = handLandmarks[17].position ?? handLandmarks[17];
        // metacarpian middle finger 
        let mcMidPred = new THREE.Vector3(); 
        mcMidPred.subVectors( landmarkMCMiddle, landmarkWrist ); // world
        mcMidPred.applyQuaternion( invWorldQuat ).normalize(); // hand local space
        
        //swing (with unwanted twist)
        let dirBone = boneMid.position.clone().normalize();
        let qq = new THREE.Quaternion();
        qq.setFromUnitVectors( dirBone, mcMidPred );
        boneHand.quaternion.multiply( qq );
        invWorldQuat.premultiply( qq.invert() ); // update hand's world to local quat
    
        // twist
        let mcPinkyPred = (new THREE.Vector3()).subVectors( landmarkMCPinky, landmarkWrist );
        let mcIndexPred = (new THREE.Vector3()).subVectors( landmarkMCIndex, landmarkWrist );
        let palmDirPred = (new THREE.Vector3()).crossVectors(mcPinkyPred, mcIndexPred).normalize(); // world space
        palmDirPred.applyQuaternion( invWorldQuat ).normalize(); // local space
        let palmDirBone = (new THREE.Vector3()).crossVectors(bonePinky.position, boneIndex.position).normalize(); // local space. Cross product "does not care" about input sizes
        qq.setFromUnitVectors( palmDirBone, palmDirPred ).normalize();
        boneHand.quaternion.multiply( qq ).normalize();

        if( this.smoothRotations ){
            this.smoothBoneQuaternion( boneHand, deltaTime );
        }
    }
    
    computeQuatPhalange( skeleton, handLandmarks, isLeft = false, bindQuats = null, deltaTime = 0 ){
        if ( !handLandmarks ){ return; }
        //handlandmarks is an array of {x,y,z,visiblity} (mediapipe)
    
        const bonePhalanges = isLeft ? 
        [ 13,14,15,16,    17,18,19,20,    21,22,23,24,    25,26,27,28,    29,30,31,32 ] :
        [ 53,54,55,56,    49,50,51,52,    45,46,47,48,    41,42,43,44,    37,38,39,40 ];
    
        let tempVec3_1 = new THREE.Vector3();
        let tempVec3_2 = new THREE.Vector3();
        const invWorldQuat = new THREE.Quaternion();
    
        const landmarkWrist = handLandmarks[0].position ?? handLandmarks[0];
        const landmarkMCIndex = handLandmarks[5].position ?? handLandmarks[5];
        const landmarkMCPinky = handLandmarks[17].position ?? handLandmarks[17];
    
        tempVec3_1.subVectors(landmarkMCIndex, landmarkWrist).normalize();
        tempVec3_2.subVectors(landmarkMCPinky, landmarkWrist).normalize();
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
    
            const landmarkFingerBase = handLandmarks[f+0].position ?? handLandmarks[f+0];
            const landmarkFingerMid = handLandmarks[f+1].position ?? handLandmarks[f+1];
            const landmarkFingerHigh = handLandmarks[f+2].position ?? handLandmarks[f+2];
            const landmarkFingerTip = handLandmarks[f+3].position ?? handLandmarks[f+3];
    
            // fingers can slightly move laterally. Compute the mean lateral movement of the finger
            let meanSideDeviation = 0;
            tempVec3_1.subVectors(landmarkFingerMid, landmarkFingerBase).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            const fingerBend = handNormal.dot(tempVec3_1);
            tempVec3_1.subVectors(landmarkFingerHigh, landmarkFingerMid).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            tempVec3_1.subVectors(landmarkFingerTip, landmarkFingerHigh).normalize();
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
                if( !boneSrc || !boneTrg) {
                    continue;
                }
                const landmark = f + i;
                if ( bindQuats ){
                    boneSrc.quaternion.copy( bindQuats[ bonePhalanges[ f+i-1 ] ] );
                }
                boneSrc.updateWorldMatrix( true, false );
            
                // world mediapipe phalange direction
                let v_phalange = new THREE.Vector3();
                const landmarkPhalangeBase = handLandmarks[landmark].position ?? handLandmarks[landmark];
                const landmarkPhalangeTop = handLandmarks[landmark+1].position ?? handLandmarks[landmark+1];
                v_phalange.subVectors( landmarkPhalangeTop, landmarkPhalangeBase ).normalize();
    
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

                if( this.smoothRotations ){
                    this.smoothBoneQuaternion( boneSrc, deltaTime );
                }
            }// end of phalange for
    
            // add lateral deviation for fingers, only on the base bone. Right now, fingers are all in the plane ( Normal x Forward )
            if( f > 4 ){
                const boneSrc = skeleton.bones[ bonePhalanges[ f-1 ] ];
                if( !boneSrc ) {
                    continue;
                }
                boneSrc.updateMatrixWorld(true);
                let q = new THREE.Quaternion();
                boneSrc.matrixWorld.decompose(tempVec3_1, q, tempVec3_1);
                latDevNormal.applyQuaternion( q.invert() );
                latDevQuat.setFromAxisAngle( latDevNormal, (Math.PI-Math.acos(meanSideDeviation)) - Math.PI*0.5);
                boneSrc.quaternion.multiply(latDevQuat);
            }
        } // end of finger 'for'
    }
    
    createBodyPoseFromWorldLandmarks( skeleton, worldLandmarks, deltaTime = 0 ){
        const landmarksBody = worldLandmarks.PWLM;
        const landmarksRightHand = worldLandmarks.RWLM;
        const landmarksLeftHand = worldLandmarks.LWLM;
    
        this.computeSpine( skeleton, landmarksBody, null, deltaTime );
        this.computeQuatHead( skeleton, landmarksBody, null, deltaTime );
    
        // right arm-hands
        this.computeQuatArm( skeleton, landmarksBody, false, deltaTime );
        this.computeQuatHand( skeleton, landmarksRightHand, false, deltaTime ); 
        this.computeQuatPhalange( skeleton, landmarksRightHand, false, null, deltaTime );
        
        // left arm-hands
        this.computeQuatArm( skeleton, landmarksBody, true, deltaTime );
        this.computeQuatHand( skeleton, landmarksLeftHand, true, deltaTime ); 
        this.computeQuatPhalange( skeleton, landmarksLeftHand, true, null, deltaTime );
    }
    
    createBodyAnimationFromWorldLandmarks( skeleton, worldLandmarksArray ){
        skeleton.pose(); // bind pose

        // reset smoothing variables
        this.kf = {};
    
        let tracks = [];
        let bindQuats = [];
        for( let i = 0; i < skeleton.bones.length; ++i ){
            tracks.push( new Float32Array( worldLandmarksArray.length * 4 ) );
            bindQuats.push( skeleton.bones[i].quaternion.clone() );
        }
        let times = new Float32Array( worldLandmarksArray.length );
        let timeAcc = 0;
    
        // for each frame compute and update quaternions
        for( let i = 0; i < worldLandmarksArray.length; ++i ){
            const deltaTime = worldLandmarksArray[i].dt < 0.00001 ? 0.00001 : worldLandmarksArray[i].dt/1000; // necessary for smoothing
            const landmarksBody = worldLandmarksArray[i].PWLM;
            const landmarksRightHand = worldLandmarksArray[i].RWLM;
            const landmarksLeftHand = worldLandmarksArray[i].LWLM;
    
            this.computeSpine( skeleton, landmarksBody, bindQuats, deltaTime );
            this.computeQuatHead( skeleton, landmarksBody, bindQuats, deltaTime );
    
            // right arm-hands
            this.computeQuatArm( skeleton, landmarksBody, false, deltaTime );
            if(worldLandmarksArray[i].rightHandVisibility > 0.3) {
                this.computeQuatHand( skeleton, landmarksRightHand, false, deltaTime ); 
                this.computeQuatPhalange( skeleton, landmarksRightHand, false, bindQuats, deltaTime );
            }
            
            // left arm-hands
            this.computeQuatArm( skeleton, landmarksBody, true, deltaTime );
            if(worldLandmarksArray[i].leftHandVisibility > 0.3) {
                this.computeQuatHand( skeleton, landmarksLeftHand, true, deltaTime ); 
                this.computeQuatPhalange( skeleton, landmarksLeftHand, true, bindQuats, deltaTime );
            }
    
            // // remove hips delta rotation from legs (children of hips). Hardcoded for EVA 
            // skeleton.bones[62].quaternion.copy( skeleton.bones[0].quaternion ).invert().multiply( bindQuats[0] ).multiply( bindQuats[62] );
            // skeleton.bones[57].quaternion.copy( skeleton.bones[0].quaternion ).invert().multiply( bindQuats[0] ).multiply( bindQuats[57] );
    
            // store skeleton quat values
            for( let j = 0; j < skeleton.bones.length; ++j ){
                tracks[j].set( skeleton.bones[j].quaternion.toArray(), i * 4 );
            }
    
            // store timing
            if (i != 0){ timeAcc += deltaTime; }
            times[i] = timeAcc;  
        }
    
        // for each bone create a quat track
        for( let i = 0; i < skeleton.bones.length; ++i ){
            tracks[i] = new THREE.QuaternionKeyframeTrack( skeleton.bones[i].name + ".quaternion", times.slice(), tracks[i] );
        }
    
        return new THREE.AnimationClip( "animation", -1, tracks );
    }

    applyHandSmoothingWithAnchor(handHistory, shoulderHistory, smoothFn) {
        if(handHistory.length !== shoulderHistory.length) return handHistory;

        const wristIndex = 0; // MediaPipe Hands
        const frameCount = handHistory.length;

        // Wrist and shoulder extraction
        const wristHistory = handHistory.map(frame => frame[wristIndex]);
        const shoulderPos = shoulderHistory.map(frame => frame); // world coords

        // Landmarks to wrist relative coords
        const relativeHistory = handHistory.map((frame, i) =>
            frame.map(pt => ({
                x: pt.x - wristHistory[i].x,
                y: pt.y - wristHistory[i].y,
                z: pt.z - wristHistory[i].z,
            }))
        );

        // Smooth wrist and fingers
        let fake = wristHistory.map((frame) => [frame]);
        let smoothedWrist = smoothFn(fake, 100, 0.8, [0]);
        smoothedWrist = smoothedWrist.map( f => f[0]);
        
        const smoothedRelative = smoothFn(relativeHistory,  this.lambda || 100, this.p || 0.8, [0]);

        const finalFrames = [];

        for(let i = 0; i < frameCount; i++) {
            const anchorVector = {
                x: smoothedWrist[i].x - shoulderPos[i].x,
                y: smoothedWrist[i].y - shoulderPos[i].y,
                z: smoothedWrist[i].z - shoulderPos[i].z
            };

            //  Smooth shoulder-wrist distance           
            const filteredAnchor = smoothFn([[anchorVector]],this.lambda || 100, this.p || 0.8, [0])[0][0];
            // Recompute global wrist coords
            const correctedWrist = {
                x: shoulderPos[i].x + filteredAnchor.x,
                y: shoulderPos[i].y + filteredAnchor.y,
                z: shoulderPos[i].z + filteredAnchor.z,
            };

            // Final global landmarks
            finalFrames.push(smoothedRelative[i].map(pt => ({
                x: pt.x + correctedWrist.x,
                y: pt.y + correctedWrist.y,
                z: pt.z + correctedWrist.z,
            })));
        }

        return finalFrames;
    }
    /**
     * 
     * @param {array of Mediapipe landmarks} inLandmarks each entry of the array is a frame containing an object with information about the mediapipe output { FLM, PLM, LLM, RLM, PWLM, LWLM, RWLM }
     * @returns {array of Mediapipe landmarks} same heriarchy as inLandmarks but smoothed
     */
    smoothMediapipeLandmarks(history, lambda = this.lambda, p = this.p, rootIndices = [23, 24]) {
        if (!history.length || !history[0].length) return history;

        // Convert history to THREE.Vector3 frames
        const frames = history.map(frame =>
            frame.map(lm => new THREE.Vector3(lm.x, lm.y, lm.z))
        );

        // Compute root per frame (pelvis or wrist avg)
        const rootHistory = frames.map(lms => {
            const root = new THREE.Vector3();
            rootIndices.forEach(i => {
                const lm = lms[i] || new THREE.Vector3();
                root.add(lm);
            });
            return root.multiplyScalar(1 / rootIndices.length);
        });

        // Convert to relative motion
        const relativeHistory = frames.map((lms, i) =>
            lms.map(lm => lm.clone().sub(rootHistory[i]))
        );

        // Apply Whittaker to each landmark
        const filteredRelative = relativeHistory[0].map((_, idx) => {
            const series = relativeHistory.map(f => f[idx]);
            return whittakerAsymmetricSmoothing(series, lambda, p);
        });

        const finalFrameIdx = filteredRelative[0].length - 1;
        
        // Smoothed relative pelvis (for global movement)
        const smoothedRootCur = new THREE.Vector3();
        rootIndices.forEach(i => {
            smoothedRootCur.add(
                filteredRelative[i][finalFrameIdx]
            );
        });
        smoothedRootCur.multiplyScalar(1 / rootIndices.length);

        // Initialize global translation once
        if (!this.globalTranslation) {
            this.globalTranslation = new THREE.Vector3();
            this.prevSmoothedRoot = smoothedRootCur.clone();
        }

        // Reconstructed global motion
        const rootDelta = smoothedRootCur.clone().sub(this.prevSmoothedRoot);
        this.globalTranslation.add(rootDelta);
        this.prevSmoothedRoot.copy(smoothedRootCur);

        const finalFrames = filteredRelative[0].map( (f, frameIdx) => {

            let landmarks = filteredRelative.map( land => land[frameIdx]);        
            landmarks = landmarks.map((value, i) => {
                
                if(frameIdx == filteredRelative[0].length - 1) {
                    const smoothedRel = value;
                    value = smoothedRel.clone().add(this.globalTranslation);
                }
                
                return {
                    x: value.x,
                    y: value.y,
                    z: value.z,
                    visibility: history[frameIdx][i].visibility
                };
            });
            return landmarks;
        })
    
        return finalFrames;
    }

    /**
     * 
     * @param {array of Mediapipe landmarks} history each entry of the array is a frame containing an object with information about the mediapipe output { FLM, PLM, LLM, RLM, PWLM, LWLM, RWLM }
     * @returns {array of Mediapipe landmarks} same heriarchy as history but smoothed
     */
    smoothMediapipeBlendshapes(history, lambda = this.lambda, p = this.p) {
        if (!history.length ) return history;

        // const names = [];
        // Convert history to frames
        const frames = history.map((frame) => {
            delete frame.dt;
            const names = Object.keys(frame);
            // Apply Whittaker to each landmark
            const filtered = whittakerAsymmetricSmoothing(Object.values(frame), lambda, p, false);
            const data = {};
            for(let i = 0; i < names.length; i++) {
                data[names[i]] = filtered[i];
            }
            return data;
        }
        );
        // const finalFrames = filtered.map((frame, i) => {
        //     for(let i = 0; i < names[i].length; i++) {
        //         const data = {};
        //         data[names[i]] = frame;
        //         return data;
        //     }
        // })
        return frames.pop();
    }

    smoothDetections( detections, framesCount = 15 ) {
        if( detections.body.w.length ) {
            let land = detections.body.w;
            while(this.prevBodyLandmarks.length >= framesCount) {
                this.prevBodyLandmarks.shift();
            }
            this.prevBodyLandmarks.push(detections.body.w);
            if(this.prevBodyLandmarks.length == framesCount) {
                
                land = this.smoothMediapipeLandmarks(this.prevBodyLandmarks, this.lambda || 100, this.p || 0.5, [23, 24]);
                land = land[this.prevBodyLandmarks.length-1];
                land = land.map(v => { 
                    v.x *= this.lambda;
                    v.y *= this.lambda;
                    v.z *= this.lambda;
                    return v
                })
                
            }

            detections.body.w = land//detectionsPose.worldLandmarks[0];
        }

        if( detections.leftHand.w.length ) {
            let land = detections.leftHand.w;
            while( this.prevLeftHandLandmarks.length >= framesCount ) {
                this.prevLeftHandLandmarks.shift();
            }
            this.prevLeftHandLandmarks.push(detections.leftHand.w);
            if( this.prevLeftHandLandmarks.length == framesCount ) {
                const shoulderHistory = this.prevBodyLandmarks.map(frame => frame[11]); // Left Shoulder
                const smoothedLeft = this.applyHandSmoothingWithAnchor(
                    this.prevLeftHandLandmarks,
                    shoulderHistory,
                    this.smoothMediapipeLandmarks.bind(this)
                );
                land = smoothedLeft[smoothedLeft.length - 1];
                land = land.map(v => { 
                    v.x *= this.lambda;
                    v.y *= this.lambda;
                    v.z *= this.lambda;
                    return v
                })
            }
            detections.leftHand.w = land;
        }

        if( detections.rightHand.w.length ) {
            let land = detections.rightHand.w;
            while( this.prevRightHandLandmarks.length >= framesCount ) {
                this.prevRightHandLandmarks.shift();
            }
            this.prevRightHandLandmarks.push(detections.rightHand.w);
            if( this.prevRightHandLandmarks.length == framesCount ) {
                const shoulderHistory = this.prevBodyLandmarks.map(frame => frame[11]); // Right Shoulder
                const smoothedright = this.applyHandSmoothingWithAnchor(
                    this.prevRightHandLandmarks,
                    shoulderHistory,
                    this.smoothMediapipeLandmarks.bind(this)
                );
                land = smoothedright[smoothedright.length - 1];
                land = land.map(v => { 
                    v.x *= this.lambda;
                    v.y *= this.lambda;
                    v.z *= this.lambda;
                    return v
                })
            }
            detections.rightHand.w = land;
        }

        if( detections.face ) {
            let b = detections.face;
            while( this.prevFaceBlendshapes.length >= framesCount ) {
                this.prevFaceBlendshapes.shift();
            }
            this.prevFaceBlendshapes.push(detections.face);
            // if( this.prevFaceBlendshapes.length == framesCount ) {
            //     b = this.smoothMediapipeBlendshapes( this.prevFaceBlendshapes, 50, 0.25);
            // }
           detections.face = b;
        }
        return detections;
    }

    /**
     * history: [THREE.Quaternion, THREE.Quaternion, ...]  // for frame
     * lambda: smoother Whittaker
     * p: asymmetric factor
     *
     */
    smoothQuaternionsByJointLocal(history, lambda = 50, p = 0.25) {
        if (!history || Object.keys(history).length === 0) return {};
   
        const series = history;

        const smoothedSeries = whittakerQuaternionSeries(series, lambda, p, false);

        // // Slpit components
        // const components = ['x', 'y', 'z', 'w'];
        // const compSeries = components.map(c => series.map(q => q[c]));

        // // Asymmetric filter for each component
        // const filteredComp = compSeries.map(s => whittakerAsymmetricSmoothing(s, lambda, p, false));

        // // Recompute quaternion for last frame
        // const lastIdx = series.length - 1;
        // const q = new THREE.Quaternion(
        //     filteredComp[0][lastIdx],
        //     filteredComp[1][lastIdx],
        //     filteredComp[2][lastIdx],
        //     filteredComp[3][lastIdx]
        // ).normalize();
    
        return smoothedSeries[smoothedSeries.length - 1].normalize();
    }

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

       
        if ( detections.face ) {
            let blends = {};
            blends = detections.face;
            if(blends["LeftEyeYaw"] == null) {
                blends["LeftEyeYaw"] = (blends["EyeLookOutLeft"] - blends["EyeLookInLeft"]) * 0.5;
                blends["RightEyeYaw"] = - (blends["EyeLookOutRight"] - blends["EyeLookInRight"]) * 0.5;
                blends["LeftEyePitch"] = (blends["EyeLookDownLeft"] - blends["EyeLookUpLeft"]) * 0.5;
                blends["RightEyePitch"] = (blends["EyeLookDownRight"] - blends["EyeLookUpRight"]) * 0.5;
            }
            
            detections.face = blends;
            const meshes = [];
            for( let object in this.morphTargets ) {
                const mesh = this.model.getObjectByName(object);
                mesh.morphTargetInfluences.fill(0);
                meshes.push(mesh);
            }

            const actionUnits = {};
            for( let au in Visualizer.mediapipeMap ) {
                let bs = Visualizer.mediapipeMap[au];
                let morphTarget = this.characterMap[au];
                if( !bs || !bs.length || !morphTarget || !morphTarget.length ){ continue;}
    
                for(let i = 0; i < bs.length; i++) {
                    const bsName = bs[i][0];
                    if(!actionUnits[au]) {
                        actionUnits[au] = 0;
                    }
                    if(!blends[bsName]) {
                        blends[bsName] = 0;
                    }
                    actionUnits[au]= blends[bsName] * bs[i][1];
                    for( let m = 0; m < meshes.length; m++ ) {
                        const mesh = meshes[m];
                        for(let mt = 0; mt < morphTarget.length; mt++) {
                            const idx = this.morphTargets[mesh.name][morphTarget[mt][0]];
                            if( idx == null) {
                                continue;
                            }
    
                            mesh.morphTargetInfluences[idx]+= actionUnits[au] * morphTarget[mt][1];
                        }
                    }
                }
            }            
        }

    }
    
}

export {Visualizer}

Visualizer.mediapipeMap = {
        "Inner_Brow_Raiser": [["BrowInnerUp", 1.0]],
        "Outer_Brow_Raiser_Left": [["BrowOuterUpLeft", 1.0]],
        "Outer_Brow_Raiser_Right":  [["BrowOuterUpRight", 1.0]],
        "Brow_Lowerer_Left": [["BrowDownLeft", 1.0]],
        "Brow_Lowerer_Right": [["BrowDownRight", 1.0]],
        "Nose_Wrinkler_Left": [["NoseSneerLeft", 1.0]],
        "Nose_Wrinkler_Right": [["NoseSneerRight", 1.0]],
        "Nostril_Dilator": [],
        "Nostril_Compressor": [],
        "Dimpler_Left": [["MouthDimpleLeft", 1.0]],
        "Dimpler_Right": [["MouthDimpleRight", 1.0]],
        "Upper_Lip_Raiser_Left": [["MouthUpperUpLeft", 1.0]],
        "Upper_Lip_Raiser_Right": [["MouthUpperUpRight", 1.0]],
        "Lip_Corner_Puller_Left": [["MouthSmileLeft", 1.0]],
        "Lip_Corner_Puller_Right": [["MouthSmileRight", 1.0]],
        "Lip_Corner_Depressor_Left": [["MouthFrownLeft", 1.0]],
        "Lip_Corner_Depressor_Right": [["MouthFrownRight", 1.0]],
        "Lower_Lip_Depressor_Left": [["MouthLowerDownLeft", 1.0]],
        "Lower_Lip_Depressor_Right": [["MouthLowerDownRight", 1.0]],
        "Lip_Puckerer_Left": [["MouthPucker", 0.5]],
        "Lip_Puckerer_Right": [["MouthPucker", 0.5]],
        "Lip_Stretcher_Left": [["MouthStretchLeft", 1.0]],
        "Lip_Stretcher_Right": [["MouthStretchRight", 1.0]],
        "Lip_Funneler": [["MouthFunnel", 1.0]],
        "Lip_Pressor_Left": [["MouthPressLeft", 1.0]],
        "Lip_Pressor_Right": [["MouthPressRight", 1.0]],
        "Lips_Part": [],
        "Lip_Suck_Upper": [["MouthRollUpper", 1.0]],
        "Lip_Suck_Lower": [["MouthRollLower", 1.0]],
        "Lip_Wipe": [["MouthShrugLower", 1.0]],
        "Tongue_Up": [],
        "Tongue_Show": [["TongueOut", 1.0]],
        "Tongue_Bulge_Left": [],
        "Tongue_Bulge_Right": [],
        "Tongue_Wide": [],
        "Mouth_Stretch": [["MouthStretchLeft", 0.5], ["MouthStretchRight", 0.5]],
        "Jaw_Drop": [["JawOpen", 1.0]],
        "Jaw_Thrust": [["JawForward", 1.0]],
        "Jaw_Sideways_Left": [["JawLeft", 1.0]],
        "Jaw_Sideways_Right": [["JawRight", 1.0]],
        "Chin_Raiser": [["CheekSquintLeft", 0.5], ["CheekSquintRight", 0.5]],
        "Cheek_Raiser_Left": [["CheekSquintLeft", 1.0]],
        "Cheek_Raiser_Right": [["CheekSquintRight", 1.0]],
        "Cheek_Blow_Left": [],
        "Cheek_Blow_Right": [],
        "Cheek_Suck_Left": [],
        "Cheek_Suck_Right": [],
        "Upper_Lid_Raiser_Left": [["EyeWideLeft", 1.0]],
        "Upper_Lid_Raiser_Right": [["EyeWideRight", 1.0]],
        "Squint_Left": [["EyeSquintLeft", 1.0]],
        "Squint_Right": [["EyeSquintRight", 1.0]],
        "Blink_Left": [["EyeBlinkLeft", 1.0]],
        "Blink_Right": [["EyeBlinkRight", 1.0]],
        "Wink_Left": [],
        "Wink_Right": [],
        "Neck_Tightener": []
    }
/**
 * Asymmetric Whittaker Smoothing
 * @param {Array<number>} y - Original data series
 * @param {number} lambda - Smoothness (100 - 1e7 usual range)
 * @param {number} p - Asymmetry parameter (0-1), typical 0.001 - 0.1
 * @returns {Array<number>} Smoothed data
 */
function whittakerAsymmetricSmoothing(data, lambda = 1000, p = 0.001, isVector = true) {
        // const m = values.length;
        // const w = new Array(m).fill(1);
        // const z = [...values];

        // for (let iter = 0; iter < 6; iter++) { // less iterations for real-time
        //     const W = z.map((_, i) => w[i] * values[i]);
        //     const A = Array.from({ length: m }, () => new Array(m).fill(0));

        //     // diagonales
        //     for (let i = 0; i < m; i++) A[i][i] = w[i] + lambda * 6;

        //     // second-derivative penalization
        //     for (let i = 0; i < m - 1; i++) {
        //         A[i][i + 1] -= lambda * 4;
        //         A[i + 1][i] -= lambda * 4;
        //     }
        //     for (let i = 0; i < m - 2; i++) {
        //         A[i][i + 2] += lambda;
        //         A[i + 2][i] += lambda;
        //     }

        //     // resolve Ax = W (remove fast gaussian)
        //     for (let i = 0; i < m; i++) {
        //         for (let j = i + 1; j < m; j++) {
        //             const factor = A[j][i] / A[i][i];
        //             for (let k = i; k < m; k++) {
        //                 A[j][k] -= factor * A[i][k];
        //             }
        //             W[j] -= factor * W[i];
        //         }
        //     }
        //     for (let i = m - 1; i >= 0; i--) {
        //         for (let j = i + 1; j < m; j++) {
        //             W[i] -= A[i][j] * z[j];
        //         }
        //         z[i] = W[i] / A[i][i];
        //     }

        //     // asymmetry
        //     for (let i = 0; i < m; i++) {
        //         w[i] = (values[i] > z[i]) ? p : (1 - p);
        //     }
        // }

        // return z;
        const smoothAxis = (values) => {
            const m = values.length;
            const w = new Array(m).fill(1);
            const z = [...values];

            for (let iter = 0; iter < 10; iter++) {
                const W = z.map((_, i) => w[i] * values[i]);

                // Solve (W + lambda * D'D) z = W * y
                const A = Array.from({ length: m }, () => new Array(m).fill(0));

                // Diagonal weights
                for (let i = 0; i < m; i++) A[i][i] = w[i] + lambda * 6;

                // Second derivative penalty matrix
                for (let i = 0; i < m - 1; i++) {
                    A[i][i + 1] -= lambda * 4;
                    A[i + 1][i] -= lambda * 4;
                }
                for (let i = 0; i < m - 2; i++) {
                    A[i][i + 2] += lambda;
                    A[i + 2][i] += lambda;
                }

                // Gaussian elimination
                for (let i = 0; i < m; i++) {
                    for (let j = i + 1; j < m; j++) {
                        const factor = A[j][i] / A[i][i];
                        for (let k = i; k < m; k++) {
                            A[j][k] -= factor * A[i][k];
                        }
                        W[j] -= factor * W[i];
                    }
                }

                for (let i = m - 1; i >= 0; i--) {
                    for (let j = i + 1; j < m; j++) {
                        W[i] -= A[i][j] * z[j];
                    }
                    z[i] = W[i] / A[i][i];
                }

                for (let i = 0; i < m; i++) {
                    w[i] = (values[i] > z[i]) ? p : (1 - p);
                }
            }

            return z;
        };

        if( isVector ) {
            const xs = data.map(v => v.x);
            const ys = data.map(v => v.y);
            const zs = data.map(v => v.z);
    
            const sx = smoothAxis(xs);
            const sy = smoothAxis(ys);
            const sz = smoothAxis(zs);
            return data.map((_, i) => new THREE.Vector3(sx[i], sy[i], sz[i]));
        }
        else {
            return smoothAxis(data);
        }
    
}

// qSeries: array dof quaternions (THREE.Quaternion)
function whittakerQuaternionSeries(qSeries, lambda, p) {
    if (!qSeries.length) return [];

    const smoothed = [];
    smoothed[0] = qSeries[0].clone();

    for (let i = 1; i < qSeries.length; i++) {
        // computes dynamic weight using Whittaker over angular change magnitud
        const angleDelta = smoothed[i-1].angleTo(qSeries[i]);
        const alpha = 1 / (1 + lambda * Math.pow(angleDelta, p));

        const qNew = smoothed[i-1].clone().slerp(qSeries[i], alpha);
        smoothed.push(qNew.normalize());
    }

    return smoothed;
}