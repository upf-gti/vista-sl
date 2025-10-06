import * as THREE  from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader, AnimationRetargeting } from './KeyframeApp.js';
function quadraticBezierVec3( a, b, c, out, t ){
    let invT = 1.0 - t;
    let ta = invT * invT;
    let tb = 2 * t * invT;
    let tc = t * t;

    out.x = a.x * ta + b.x * tb + c.x * tc;
    out.y = a.y * ta + b.y * tb + c.y * tc;
    out.z = a.z * ta + b.z * tb + c.z * tc;
    return out;
}

function cubicBezierVec3( a, b, c, d, out, t ){
    let invT = 1.0 - t;
    let ta = invT * invT * invT;
    let tb = 3 * t * invT * invT;
    let tc = 3 * t * t * invT;
    let td = t * t * t;

    out.x = a.x * ta + b.x * tb + c.x * tc + d.x * td;
    out.y = a.y * ta + b.y * tb + c.y * tc + d.y * td;
    out.z = a.z * ta + b.z * tb + c.z * tc + d.z * td;
    return out;
}
// ------------ THREEJS Quaternions

// mirror THREE.Quaternion for avatars
function mirrorQuat( destQuat, srcQuat ){
    //destQuat.x = srcQuat.x;
    destQuat.y = -srcQuat.y;
    destQuat.z = -srcQuat.z;
    //destQuat.w = srcQuat.w;
}

function mirrorQuatSelf( q ){
    //q.x = -q.x;
    q.y = -q.y;
    q.z = -q.z;
    //q.w = q.w;
}

// nlerp THREE.Quaternion. Good for interpolation between similar/close quaternions. Cheaper than slerp
function nlerpQuats( destQuat, qa, qb, t ){
    // let bsign = ( qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w ) < 0 ? -1 : 1;    
    // destQuat.x = qa.x * (1-t) + bsign * qb.x * t;
    // destQuat.y = qa.y * (1-t) + bsign * qb.y * t;
    // destQuat.z = qa.z * (1-t) + bsign * qb.z * t;
    // destQuat.w = qa.w * (1-t) + bsign * qb.w * t;
    // missing neighbourhood
    destQuat.x = qa.x * (1-t) + qb.x * t;
    destQuat.y = qa.y * (1-t) + qb.y * t;
    destQuat.z = qa.z * (1-t) + qb.z * t;
    destQuat.w = qa.w * (1-t) + qb.w * t;
    destQuat.normalize();
}

// decompose a quaternion into twist and swing quaternions. (Twist before swing decomposition). Arguments cannot be the same instance of quaternion
function getTwistSwingQuaternions( q, normAxis, outTwist, outSwing ){
    //  R = [ Wr, Vr ] = S * T  source rotation
    // T = norm( [ Wr, proj(Vr) ] ) twist 
    // S = R * inv(T)
    let dot =  q.x * normAxis.x + q.y * normAxis.y + q.z * normAxis.z;
    outTwist.set( dot * normAxis.x, dot * normAxis.y, dot * normAxis.z, q.w )
    outTwist.normalize(); // already manages (0,0,0,0) quaternions by setting identity

    outSwing.copy( outTwist );
    outSwing.invert(); // actually computes the conjugate so quite cheap
    outSwing.premultiply( q );
    outSwing.normalize();
}

function getTwistQuaternion( q, normAxis, outTwist ){
    let dot =  q.x * normAxis.x + q.y * normAxis.y + q.z * normAxis.z;
    outTwist.set( dot * normAxis.x, dot * normAxis.y, dot * normAxis.z, q.w )
    outTwist.normalize(); // already manages (0,0,0,0) quaternions by setting identity
    return outTwist;
}

// symmetry bit0 = left-right, bit1 = up-down, bit2 = in-out symmetry
function stringToDirection( str, outV, symmetry = 0x00, accumulate = false ){
    outV.set(0,0,0);
    if ( typeof( str ) != "string" ){ return false; }

    str = str.toUpperCase();
    let success = false;

    // right hand system. If accumulate, count repetitions
    if ( str.includes( "L" ) ){ outV.x += 1 * ( accumulate ? ( str.split("L").length -1 ): 1 ); success = true; } 
    if ( str.includes( "R" ) ){ outV.x -= 1 * ( accumulate ? ( str.split("R").length -1 ): 1 ); success = true; }
    if ( str.includes( "U" ) ){ outV.y += 1 * ( accumulate ? ( str.split("U").length -1 ): 1 ); success = true; } 
    if ( str.includes( "D" ) ){ outV.y -= 1 * ( accumulate ? ( str.split("D").length -1 ): 1 ); success = true; }
    if ( str.includes( "O" ) ){ outV.z += 1 * ( accumulate ? ( str.split("O").length -1 ): 1 ); success = true; } 
    if ( str.includes( "I" ) ){ outV.z -= 1 * ( accumulate ? ( str.split("I").length -1 ): 1 ); success = true; }
 
    if ( symmetry & 0x01 ){ outV.x *= -1; }
    if ( symmetry & 0x02 ){ outV.y *= -1; }
    if ( symmetry & 0x04 ){ outV.z *= -1; }

    if ( !success ){ outV.set(0,0,0); }
    else if ( !accumulate ){ outV.normalize(); }
    return success;
}


// Skeleton

// O(n)
function findIndexOfBone( skeleton, bone ){
    if ( !bone ){ return -1;}
    let b = skeleton.bones;
    for( let i = 0; i < b.length; ++i ){
        if ( b[i] == bone ){ return i; }
    }
    return -1;
}

// O(nm)
function findIndexOfBoneByName( skeleton, name ){
    if ( !name ){ return -1; }
    let b = skeleton.bones;
    for( let i = 0; i < b.length; ++i ){
        if ( b[i].name == name ){ return i; }
    }
    return -1;
}

function getBindQuaternion( skeleton, boneIdx, outQuat ){
    let m1 = skeleton.boneInverses[ boneIdx ].clone().invert(); 
    let parentIdx = findIndexOfBone( skeleton, skeleton.bones[ boneIdx ].parent );
    if ( parentIdx > -1 ){
        let m2 = skeleton.boneInverses[ parentIdx ]; 
        m1.premultiply(m2);
    }
    outQuat.setFromRotationMatrix( m1 ).normalize();
    return outQuat;
}

// sets bind quaternions only. Warning: Not the best function to call every frame.
function forceBindPoseQuats( skeleton, skipRoot = false ){
    let bones = skeleton.bones;
    let inverses = skeleton.boneInverses;
    if ( inverses.length < 1 ){ return; }
    let boneMat = inverses[0].clone(); 
    let _ignoreVec3 = skeleton.bones[0].position.clone();
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

// @BehaviourManager

// Message gets to BehaviourManager -> then to facial control -> then to BehaviorRealizer

// Needs to synchronize BML actions of the same block
// [MERGE,APPEND,REPLACE,OVERWRITE]
// Warnings and feedback
// wait, synchronize, constraints, before, after

function BehaviourManager() {

	// BML instruction keys
	this.bmlKeys = ["blink", "gaze", "gazeShift", "face", "faceShift", "head", "headDirectonShift", "lg", "gesture", "posture", "animation"];

	// BML stack
	this.blinkStack = [];
	this.gazeStack = [];
	this.faceStack = [];
	this.headStack = [];
	this.headDirStack = [];
	this.speechStack = [];
	this.gestureStack = [];
	this.pointingStack = [];
	this.postureStack = [];

	this.lgStack = [];
	this.animationStack = [];

	this.BMLStacks = [ this.blinkStack, this.gazeStack, this.faceStack, this.headStack, this.headDirStack, this.speechStack, this.lgStack,
	this.gestureStack, this.pointingStack, this.postureStack, this.animationStack ];

	// Block stack
	this.stack = [];
}

BehaviourManager.prototype.reset = function (){
	// reset stacks
	this.blinkStack.length = 0
	this.gazeStack.length = 0;
	this.faceStack.length = 0;
	this.headStack.length = 0;
	this.headDirStack.length = 0;
	this.speechStack.length = 0;
	this.gestureStack.length = 0;
	this.pointingStack.length = 0;
	this.postureStack.length = 0;
	this.lgStack.length = 0;
	this.animationStack.length = 0;

	this.stack.length = 0;
}

// TODO: PROVIDE FEEDBACK AND WARNINGS
// BehaviourManager.prototype.update = function (actionCallback, time) {

// 	// Time now
// 	this.time = time;

// 	// Several blocks can be active (MERGE composition)
// 	for (let i = 0; i < this.stack.length; i++) {
// 		// If it is not active
// 		if (!this.stack[i].isActive) {
// 			// Block starts
// 			if (this.stack[i].startGlobalTime <= this.time) {
// 				this.stack[i].isActive = true;
// 			}
// 		}
// 		// Check if has ended
// 		if ( this.stack[i].isActive ) {
// 			if (this.stack[i].endGlobalTime <= this.time) {
// 				this.stack[i].isActive = false;
// 				// Remove
// 				this.removeFromStacks(this.stack[i]);
// 				this.stack.splice(i, 1);
// 				i--;
// 			}
// 		}
// 	}
	

// 	// Check active BML and blocks (from BMLStacks)
// 	for (let i = 0; i < this.BMLStacks.length; i++) {
// 		// Select bml instructions stack
// 		let stack = this.BMLStacks[i];
// 		for (let j = 0; j < stack.length; j++) {
// 			let bml = stack[j];

// 			// BML is not active
// 			if ( !bml.isActive ) {
// 				// Set BML to active
// 				if (bml.startGlobalTime <= this.time) {
// 					bml.isActive = true;
// 					actionCallback(bml.key, bml); // CALL BML INSTRUCTION
// 				}
// 			}
// 			// BML has finished
// 			else if (bml.isActive) {
// 				if (bml.endGlobalTime <= this.time) {
// 					bml.isActive = undefined;
// 					// Remove from bml stack
// 					stack.splice(j, 1);
// 					j--;
// 				}
// 			}
// 		}
// 	}
// }

// V2 update: stacks will only contain blocks/bmls that have not started yet
BehaviourManager.prototype.update = function (actionCallback, time) {
	// Time now
	this.time = time;

	// Several blocks can be active (MERGE composition)
	for (let i = 0; i < this.stack.length; i++) {
		// If it is not active
		if (!this.stack[i].isActive) {
			// Block starts
            if (this.stack[i].startGlobalTime <= this.time) {
				this.stack.splice(i, 1);
				i--;
			}
		}
	}
	

	// Check active BML and blocks (from BMLStacks)
	for (let i = 0; i < this.BMLStacks.length; i++) {
		// Select bml instructions stack
		let stack = this.BMLStacks[i];
		for (let j = 0; j < stack.length; j++) {
			let bml = stack[j];

			// Set BML to active
			if (bml.startGlobalTime <= this.time) {
				actionCallback(bml.key, bml); // CALL BML INSTRUCTION
				stack.splice(j, 1);
				j--;
			}
		}
	}
}

BehaviourManager.prototype.newBlock = function (block, time) {

	if (!block) {
		return;
	}

	// Time now
	if (time == 0) {
		time = 0.001;
	}
	this.time = time;

	// TODO: require
	// Fix and Sychronize (set missing timings) (should substitute "start:gaze1:end + 1.1" by a number)
	this.fixBlock(block);

	// Remove blocks with no content
	if (block.end == 0) {
		//console.error("Refused block.\n", JSON.stringify(block));
		return;
	}

	// Add to stack
	this.addToStack(block);

}

BehaviourManager.prototype.fixBlock = function (block) {
	// Define block start (in BML this is not specified, only in bml instructions, not in blocks)
	//block.start = block.start || 0.0;
	// Check if it is a number
	block.start = isNaN(block.start) ? 0 : block.start;

	// Define timings and find sync attributes (defaults in percentage unless start and end)
	// Blink
	if (block.blink)
		block.blink = this.fixBML(block.blink, "blink", block, { start: 0, attackPeak: 0.25, relax: 0.25, end: 0.5 });

	// Gaze
	if (block.gaze)
		block.gaze = this.fixBML(block.gaze, "gaze", block, { start: 0, ready: 0.33, relax: 0.66, end: 2.0 });

	// GazeShift
	if (block.gazeShift)
		block.gazeShift = this.fixBML(block.gazeShift, "gazeShift", block, { start: 0, end: 2.0 });

	// Head
	if (block.head)
		block.head = this.fixBML(block.head, "head", block, { start: 0, ready: 0.15, strokeStart: 0.15, stroke: 0.5, strokeEnd: 0.8, relax: 0.8, end: 2.0 });

	// HeadDirection
	if (block.headDirectionShift)
		block.headDirectionShift = this.fixBML(block.headDirectionShift, "headDirectionShift", block, { start: 0, end: 2.0 });

	// Face
	if (block.face)
		block.face = this.fixBML(block.face, "face", block, { start: 0, attackPeak: 0.4, relax: 0.6, end: 1 });
	// Face
	if (block.faceFACS)
		block.faceFACS = this.fixBML(block.faceFACS, "faceFACS", block, { start: 0, attackPeak: 0.4, relax: 0.6, end: 1 });

	// Face
	if (block.faceLexeme)
		block.faceLexeme = this.fixBML(block.faceLexeme, "faceLexeme", block, { start: 0, attackPeak: 0.4, relax: 0.6, end: 1 });

	// Face
	if (block.faceEmotion)
		block.face = this.fixBML(block.faceEmotion, "face", block, { start: 0, attackPeak: 0.4, relax: 0.6, end: 1 });

	// Face VA
	if (block.faceVA)
		block.face = this.fixBML(block.faceVA, "face", block, { start: 0, attackPeak: 0.4, relax: 0.6, end: 1 });

	// FaceShift
	if (block.faceShift)
		block.faceShift = this.fixBML(block.faceShift, "faceShift", block, { start: 0, end: 1 });

	// Speech (several instructions not implemented)
	if (block.speech)
		block.speech = this.fixBML(block.speech, "speech", block, { start: 0, end: 2.5 });

	// Language-generation
	if (block.lg)
		block.lg = this.fixBML(block.lg, "lg", block, { start: 0, end: 1 });

	// Posture
	if (block.posture)
		block.posture = this.fixBML(block.posture, "posture", block, { start: 0, ready: 0.3, strokeStart: 0.3, stroke: 0.4, strokeEnd: 0.6, relax: 0.7, end: 1.0 });

	// Gesture
	if (block.gesture)
		block.gesture = this.fixBML(block.gesture, "gesture", block, { start: 0, ready: 0.1, strokeStart: 0.2, stroke: 0.7, strokeEnd: 0.7, relax: 1.4, end: 1.5 });

	// Pointing
	if (block.pointing)
		block.pointing = this.fixBML(block.pointing, "pointing", block, { start: 0, ready: 0.3, strokeStart: 0.3, stroke: 0.4, strokeEnd: 0.6, relax: 0.7, end: 1.0 });

	// Animation
	if (block.animation)
		block.animation = this.fixBML(block.animation, "animation", block, { start: 0, end: 2.0 });

	// Find end of block
	block.end = this.findEndOfBlock(block);
}

BehaviourManager.prototype.fixBML = function (bml, key, block, sync) {
	// Error check
	if (!bml) {
		console.warn("BML instruction undefined or null:", key, bml);
		delete block[key];
		return;
	}

	// Several instructions inside
	if (bml.constructor === Array) {
		for (var i = 0; i < bml.length; i++)
			bml[i] = this.fixBML(bml[i], key, block, sync);
		return bml;
	}

	// Check if is it an object
	if (typeof bml !== "object" || bml === null)
		bml = {};

	// Define type (key)
	bml.key = key;

	// Define timings
	// START
	bml.start = isNaN(bml.start) ? 0.0 : bml.start;
	if (bml.start < 0) {
		bml.start = 0;
	}
	// END
	bml.end = isNaN(bml.end) ? (bml.start + sync.end) : bml.end;

	return bml;
}


BehaviourManager.prototype.findEndOfBlock = function (block) {

	let keys = Object.keys(block);
	let latestEnd = 0;

	for (let i = 0; i < keys.length; i++) {
		let bml = block[keys[i]];
		if (bml === null || bml === undefined) { continue; }
		else if ( !isNaN( bml.end ) ) // bml is just an instruction
			latestEnd = Math.max(bml.end, latestEnd);

		else if (bml.constructor === Array){ // several instructions inside class
			for (let j = 0; j < bml.length; j++) {
				if (bml[j] && !isNaN( bml[j].end ) )
					latestEnd = Math.max(bml[j].end, latestEnd);
			}
		}
	}

	return latestEnd;
}

BehaviourManager.prototype.addToStack = function (block) {
	// block composition defined in bml standard [MERGE, REPLACE, APPEND]. OVERWRITE is not included

	if (Object.prototype.toString.call(block.composition) === '[object String]')
		block.composition = block.composition.toUpperCase();

	
	if (this.stack.length == 0) {
		block.startGlobalTime = this.time + block.start;
		block.endGlobalTime = this.time + block.end;
		this.stack.push( block );
	}

	// OVERWRITE
	else if (block.composition == "OVERWRITE") { // Doens't make sense, only for individual stacks, not whole
		// Substitute in stack

		block.startGlobalTime = this.time + block.start;
		block.endGlobalTime = this.time + block.end;

		let last = this.stack[this.stack.length - 1];
		if (block.endGlobalTime < last.endGlobalTime) {
			this.stack[this.stack.length - 1] = block;
			this.stack.push(last);
		}
		else
			this.stack.push(block);
		
		// Add to bml stack (called at the end of function)
	}

	// APPEND
	else if (block.composition == "APPEND") {
		//The start time of the new block will be as soon as possible after the end time of all prior blocks.
		block.startGlobalTime = this.stack[this.stack.length - 1].endGlobalTime + block.start;
		block.endGlobalTime = this.stack[this.stack.length - 1].endGlobalTime + block.end;
		this.stack.push(block);
	}

	// REPLACE
	else if (block.composition == "REPLACE") {
		//The start time of the new block will be as soon as possible. The new block will completely replace all prior bml blocks. All behavior specified in earlier blocks will be ended and the ECA will revert to a neutral state before the new block starts.

		// Second action in the stack (if start != 0 waiting time?)
		block.startGlobalTime = (this.stack[0].isActive) ? this.stack[0].endGlobalTime : this.time;
		block.endGlobalTime = block.startGlobalTime + block.end;

		// Remove following blocks
		for (let i = (this.stack[0].isActive) ? 1: 0; i < this.stack.length; i++)
			this.removeFromStacks(this.stack[i]);

		this.stack.push( block );
	}

	// MERGE (default)
	else {
		// Add to block stack
		block.startGlobalTime = this.time + block.start;
		block.endGlobalTime = this.time + block.end;

		this.stack.push(block);

		// bubble sort. Lowest endGlobalTimes should be first, Biggest endGlobalTime should be the last
		if ( this.stack.length > 1 ){
			for ( let i = this.stack.length-2; i >= 0; --i ){
				let prev = this.stack[i];
				if ( prev.startGlobalTime > block.startGlobalTime ){
					this.stack[i] = block;
					this.stack[i+1] = prev;
				}
				else{ break; }
			}
		}		
	}

	// Add to stacks
	this.addToBMLStacks(block);
}

// Removes all bml instructions from stacks
BehaviourManager.prototype.removeFromStacks = function (block) {

	// Add delete variable in block to bml instructions
	let keys = Object.keys(block);
	for (let i = 0; i < keys.length; i++) { // Through bml instructions
		let bml = block[keys[i]];
		if (bml !== null || bml !== undefined) {
			if (typeof bml === "object"){ // bml is an instruction
				bml.del = true;
			}
			else if (bml.constructor === Array){ // bml is an array of bml instructions
				for (let j = 0; j < bml.length; j++){
					bml[j].del = true;
				}
			}

		}
	}

	// Remove from each stack all bml with del
	for (let i = 0; i < this.BMLStacks.length; i++) { // Through list of stacks
		for (let j = 0; j < this.BMLStacks[i].length; j++) {// Through stack
			if (this.BMLStacks[i][j].del) { // Find del variable in stack
				this.BMLStacks[i][j].isActive = undefined; // If reusing object
				this.BMLStacks[i].splice(j, 1); // Remove from stack
				j--;
			}
		}
	}
}

// Add bml actions to stacks with global timings
BehaviourManager.prototype.addToBMLStacks = function (block) {

	let globalStart = block.startGlobalTime;

	// Blink
	if (block.blink)
		this.processIntoBMLStack(block.blink, this.blinkStack, globalStart, block.composition);

	// Gaze
	if (block.gaze)
		this.processIntoBMLStack(block.gaze, this.gazeStack, globalStart, block.composition);
	if (block.gazeShift)
		this.processIntoBMLStack(block.gazeShift, this.gazeStack, globalStart, block.composition);

	// Head
	if (block.head)
		this.processIntoBMLStack(block.head, this.headStack, globalStart, block.composition);
	if (block.headDirectionShift)
		this.processIntoBMLStack(block.headDirectionShift, this.headDirStack, globalStart, block.composition);

	// Face
	if (block.faceLexeme)
		this.processIntoBMLStack(block.faceLexeme, this.faceStack, globalStart, block.composition);

	if (block.faceFACS)
		this.processIntoBMLStack(block.faceFACS, this.faceStack, globalStart, block.composition);

	if (block.face)
		this.processIntoBMLStack(block.face, this.faceStack, globalStart, block.composition);

	if (block.faceShift)
		this.processIntoBMLStack(block.faceShift, this.faceStack, globalStart, block.composition);

	// Speech
	if (block.speech)
		this.processIntoBMLStack(block.speech, this.speechStack, globalStart, block.composition);

	// Posture
	if (block.posture)
		this.processIntoBMLStack(block.posture, this.postureStack, globalStart, block.composition);

	// Gesture
	if (block.gesture)
		this.processIntoBMLStack(block.gesture, this.gestureStack, globalStart, block.composition);

	// Pointing
	if (block.pointing)
		this.processIntoBMLStack(block.pointing, this.pointingStack, globalStart, block.composition);

	// LG
	if (block.lg)
		this.processIntoBMLStack(block.lg, this.lgStack, globalStart, block.composition);

	// Animation
	if (block.animation)
		this.processIntoBMLStack(block.animation, this.animationStack, globalStart, block.composition);
}

// Add bml action to stack
BehaviourManager.prototype.processIntoBMLStack = function (bml, stack, globalStart, composition) {

	// Several instructions
	if (bml.constructor === Array) {
		for (let i = 0; i < bml.length; i++)
			this.processIntoBMLStack(bml[i], stack, globalStart, composition);
		return;
	}


	let merged = this.mergeBML(bml,stack,globalStart,  composition);
 	bml.del = !merged;

	// First, we check if the block fits between other blocks, thus all bml instructions
	// should fit in the stack.
	if (!merged)
		console.warn("Could not add to " + bml.key + " stack. \n");// + "BML: ", 

}


BehaviourManager.prototype.mergeBML = function(bml, stack, globalStart, composition){
	let merged = false;
	
	// Refs to another block (negative global timestamp)
	if (bml.start < 0)
		bml.start = (-bml.start) - globalStart; // The ref timestamp should be always bigger than globalStart

	if (bml.end < 0)
		bml.end = (-bml.end) - globalStart;

	bml.startGlobalTime = globalStart + bml.start;
	bml.endGlobalTime = globalStart + bml.end;

	// Check errors
	if (bml.start < 0) console.error("BML start is negative", bml.start, bml.key, globalStart);
	if (bml.end < 0) console.error("BML end is negative", bml.end, bml.key, globalStart);

	// Now change all attributes from timestamps to offsets with respect to startGlobalTime
	
	// Modify all sync attributes to remove non-zero starts (offsets)
	// Also fix refs to another block (negative global timestamp)
	bml.end -= bml.start;

	if ( !isNaN(bml.attackPeak) ) 
		bml.attackPeak = this.mergeBMLSyncFix(bml.attackPeak, bml.start, globalStart);
	if ( !isNaN(bml.ready) )
		bml.ready = this.mergeBMLSyncFix(bml.ready, bml.start, globalStart);
	if ( !isNaN(bml.strokeStart) )
		bml.strokeStart = this.mergeBMLSyncFix(bml.strokeStart, bml.start, globalStart);
	if ( !isNaN(bml.stroke) )
		bml.stroke = this.mergeBMLSyncFix(bml.stroke, bml.start, globalStart);
	if ( !isNaN(bml.strokeEnd) )
		bml.strokeEnd = this.mergeBMLSyncFix(bml.strokeEnd, bml.start, globalStart);
	if ( !isNaN(bml.relax))
		bml.relax = this.mergeBMLSyncFix(bml.relax, bml.start, globalStart);

	bml.start = 0;

	bml.composition = composition;


	let overwrite = composition === "OVERWRITE";
	let merge = composition === "MERGE";

	if ( !overwrite ) {
		stack.push( bml );
		// bubble sort the stack by endGlobalTime. First the lowest 
		for( let i = stack.length-2; i > 0; --i){
			if ( stack[i].startGlobalTime > bml.startGlobalTime ){
				stack[i+1] = stack[i];
				stack[i] = bml;
			}
			else { break; }
		}
		return true;
	}


	// OLD CODE
	// add to bml stack
	// Empty
	if (stack.length == 0) {
		stack.push( bml );
		return true;
	}
	else {
		// Fits between
		if (stack.length > 1) {

			//append at the end
			if (bml.startGlobalTime >= stack[stack.length - 1].endGlobalTime){
				stack.push(bml);
				merged = true;
			}
			// fit on the stack?
			else{
				for (let i = 0; i < stack.length-1; i++){
					if(merged) break;
					// Does it fit?
					if (bml.startGlobalTime >= stack[i].endGlobalTime && bml.endGlobalTime <= stack[i + 1].startGlobalTime || i == 0 && bml.endGlobalTime < stack[i].startGlobalTime) {
						let tmp = stack.splice(i, stack.length);
						stack.push(bml);
						stack = stack.concat(tmp);
						merged = true;
					}
					// If it doesn't fit remove if overwrite
					else if (overwrite) {
						// Remove from bml stack
						stack.splice(i, 1);
						i--;
					}
					else if(merge){
						stack.push(bml);
						merged = true;
					}
				}
			}
		}
		// End of stack (stack.length == 1)
		if (!merged || overwrite) {
			// End of stack
			if (stack[stack.length - 1].endGlobalTime <= bml.startGlobalTime) {
				if (!merged) {
					stack.push(bml);
					merged = true;
				}
			}
			else if (overwrite)
				stack.splice(stack.length - 1, 1);
			else if (bml.endGlobalTime < stack[0].startGlobalTime) {// Start of stack
				stack.push(bml);
				stack.reverse();
			}
		}
	}
	// After removing conflicting bml, add
	if (overwrite && !merged) {
		stack.push(bml);
		merged = true;
	}

	return merged;
}

// Fix ref to another block (negative global timestamp) and remove start offset
BehaviourManager.prototype.mergeBMLSyncFix = function (syncAttr, start, globalStart) {
	return ( syncAttr > start ) ? ( syncAttr - start ) : 0;

	// ORIGINAL FUNCTION BELOW

	// Ref to another block
	if (syncAttr < 0) syncAttr = (-syncAttr) - globalStart;
	// Remove offset
	syncAttr -= start;

	// Check error
	if (syncAttr < 0)
		console.error("BML sync attribute is negative.", syncAttr, start, globalStart);

	return syncAttr;
}

// Checks that all stacks are ordered according to the timeline (they should be as they are insterted in order)
BehaviourManager.prototype.check = function () {
	if (this.errorCheck(this.blinkStack)) console.error("Previous error is in blink stack");
	if (this.errorCheck(this.gazeStack)) console.error("Previous error is in gaze stack");
	if (this.errorCheck(this.faceStack)) console.error("Previous error is in face stack");
	if (this.errorCheck(this.headStack)) console.error("Previous error is in head stack");
	if (this.errorCheck(this.headDirStack)) console.error("Previous error is in headDir stack");
	if (this.errorCheck(this.speechStack)) console.error("Previous error is in speech stack");
	if (this.errorCheck(this.postureStack)) console.error("Previous error is in posture stack");
	if (this.errorCheck(this.gestureStack)) console.error("Previous error is in gesture stack");
	if (this.errorCheck(this.pointingStack)) console.error("Previous error is in pointing stack");
	if (this.errorCheck(this.lgStack)) console.error("Previous error is in lg stack");
	if (this.errorCheck(this.animationStack)) console.error("Previous error is in animation stack");
}

BehaviourManager.prototype.errorCheck = function (stack) {
	// Check timings
	for (let i = 0; i < stack.length - 1; i++) {
		if (stack[i].endGlobalTime > stack[i + 1].startGlobalTime) {
			console.error("Timing error in stack: ", stack);
			return true;
		}
	}
}

//@BehaviourPlanner
//Agent's communicative intentions specified using BML standard

//States
BehaviourPlanner.WAITING = 0;
BehaviourPlanner.PROCESSING = 1;
BehaviourPlanner.SPEAKING = 2;
BehaviourPlanner.LISTENING = 3;

function BehaviourPlanner() {
  this.reset();
}

BehaviourPlanner.prototype.reset = function () {
  this.conversation = "--- New dialogue---\n\n";
  this.state = BehaviourPlanner.WAITING;
  
  //For automatic state update
  this.stateTime = 0;
  this.nextBlockIn =  1 + Math.random() * 2;
  
  // Default facial state
  this.defaultValence = 0.4;
  this.currentArousal = 0;
  
  // Idle timings (blink and saccades)
  this.blinkIdle = 0.5 + Math.random()*6;
	this.blinkDur = Math.random()*0.5 + 0.15;
	this.blinkCountdown = 0;

	this.saccIdle = 0.5 + Math.random()*6;
	this.saccDur = Math.random() + 0.5;
	this.saccCountdown = 0;
}

//UPDATE
BehaviourPlanner.prototype.update = function(dt){

  this.stateTime += dt;
  
  // Automatic state update
  if (this.nextBlockIn < this.stateTime){
    this.stateTime = 0;
    return this.createBlock();
  }
  
  // Check if speech has finished to change to WAITING
  /*if (this.state == BehaviourPlanner.SPEAKING){
    if (BehaviourPlanner.BehaviorManager){
      if (BehaviourPlanner.BehaviorManager.lgStack.length == 0 && BehaviourPlanner.BehaviorManager.speechStack.length == 0)
        this.transition({control: BehaviourPlanner.WAITING});
    }
  }*/
  
  // Automatic blink and saccades
  return this.updateBlinksAndSaccades(dt);
}

//TRANSITION to nextState
BehaviourPlanner.prototype.transition = function(block){
  
  var nextState = block.control;
  
  if (nextState == this.state)
    return;
  
  var currentState = "waiting";
  
  switch(this.state){
    case BehaviourPlanner.WAITING:
      currentState = "waiting";
      break;
    case BehaviourPlanner.LISTENING:
      currentState = "listening";
      break;
      case BehaviourPlanner.SPEAKING:
      currentState = "speaking";
      break;
      case BehaviourPlanner.PROCESSING:
      currentState = "processing";
      break;
  }
  

  // Reset state time
  this.stateTime = 0;
  
  // TRANSITIONS
  switch(nextState){
  	
      // Waiting can only come after speaking
    case BehaviourPlanner.WAITING:
    	// Look at user for a while, then start gazing around
    	this.nextBlockIn = 2 + Math.random() * 4;
  		break;
  	
      // Can start speaking at any moment
    case BehaviourPlanner.LISTENING:
    	// Force to overwrite existing bml
    	block.composition = "MERGE";
    	/*if(this.state ==BehaviourPlanner.SPEAKING){
      	// Abort speech
      	this.abortSpeech();
    	}*/
    	// Look at user and default face
    	this.attentionToUser(block, true);
    	// Back-channelling
    	this.nextBlockIn = 0 +  Math.random()*2;
			break;
  
  		// Processing always after listening
    case BehaviourPlanner.PROCESSING:
    	this.nextBlockIn = 0;
  		break;
 	 		
      // Speaking always after processing
    case BehaviourPlanner.SPEAKING:
    	this.attentionToUser(block, true);
    	// Should I create random gestures during speech?
    	this.nextBlockIn = Math.random()*1;//2 + Math.random()*4;
  	break;
  }
  
  this.state = nextState;
  
}

//!!!!!!!!!!!!!!!!!!
/*BehaviourPlanner.prototype.abortSpeech = function(){
  // Cancel audio and lipsync in Facial
  if (BehaviourPlanner.Facial){
    var facial = BehaviourPlanner.Facial;
    if (!facial._audio.paused){
    	facial._audio.pause(); // Then paused is true and no facial actions
      // Go to neutral face? Here or somewhere else?
    }
  }
  // End all blocks in BMLManager
  if (BehaviourPlanner.BMLManager){
    var manager = BehaviourPlanner.BMLManager;
    for (var i =0 ; i < manager.stack.length; i++){
      manager.stack[i].endGlobalTime = 0;
    }
  }
}*/

//---------------------------AUTOMATIC------------------------------


//CREATEBLOCKs during a state (automatic)
BehaviourPlanner.prototype.createBlock = function(){
  
  var state = this.state;
  var block = {
    id: state, 
    composition: "MERGE"
  };
  
  switch(state)
  {
  // LISTENING
    case BehaviourPlanner.LISTENING:
      this.nextBlockIn = 1.5 + Math.random()*3;
      // head -> link with this.currentArousal
      if (Math.random() < 0.4)
      {
        block.head = {
          start: 0,
          end: 1.5 + Math.random()*2,
          lexeme: "NOD",
          amount: 0.05 + Math.random()*0.05,
          type:"head"
        }
      }

      // Esporadic raising eyebrows
      if (Math.random() < 0.5)
      {
        var start = Math.random();
        var end = start + 1 + Math.random();
        block.face = [{
          start: start,
          attackPeak: start + (end-start)*0.2,
          relax: start + (end-start)*0.5,
          end: end,
          lexeme: {
            lexeme: "BROW_RAISER", 
            amount: 0.1 + Math.random()*0.2
          },
          type:"face"
        },
          {
          start: start,
          attackPeak: start + (end-start)*0.2,
          relax: start + (end-start)*0.5,
          end: end,
          lexeme: {
            lexeme: "UPPER_LID_RAISER", 
            amount: 0.1 + Math.random()*0.2
        	},
          type:"face"
        }]
        
      }
      if(Math.random() < 0.2){
        var start = Math.random();
        var end = start + 1 + Math.random();
        var f = {
          start: start,
          attackPeak: start + (end-start)*0.2,
          relax: start + (end-start)*0.5,
          end: end,
          lexeme: {
            lexeme: "CHEEK_RAISER", 
            amount: 0.1 + Math.random()*0.2
        	},
          type:"face"
        }
        if(block.face)
          block.face.push(f)
        else
          block.face = f;
      }

      // Gaze should already be towards user

      break;
  
  // SPEAKING
    case BehaviourPlanner.SPEAKING:
      
      this.nextBlockIn = 2 + Math.random()*4;
      // Head
      if (Math.random() < 0.2){
        // Deviate head slightly
        if (Math.random() < 0.85)
        {
          var start = Math.random();
          var offsetDirections = ["CAMERA","DOWN_RIGHT", "DOWN_LEFT", "LEFT", "RIGHT"]; // Upper and sides
          var randOffset = offsetDirections[Math.floor(Math.random() * offsetDirections.length)];
          // block.headDirectionShift = {
          //   start: start,
          //   end: start + Math.random(),
          //   target: "CAMERA",
          //   offsetDirection: randOffset,
          //   offsetAngle: 1 + Math.random()*3,
          //   type:"headDirectionShift"
          // }
        }
      }
      // Esporadic raising eyebrows
      if (Math.random() < 0.7)
      {
        var start = Math.random();
        var end = start + 1.2 + Math.random()*0.5;
        block.face = {
          start: start,
          attackPeak: start + (end-start)*0.2,
          relax: start + (end-start)*0.5,
          end: end,
          lexeme: {
            lexeme: "BROW_RAISER", 
            amount: 0.1 + Math.random()*0.2
          },
           type:"face"
        }
      }
      // Redirect gaze to user
      if (Math.random() < 0.7)
      {
        // var start = Math.random();
        // var end = start + 0.5 + Math.random()*1;
        // block.gazeShift = {
        //   start: start,
        //   end: end,
        //   influence: "EYES",
        //   target: "CAMERA",
        //   type:"gazeShift"
        // }
        block.composition = "MERGE";
      }

    	break;
  
  
  // PROCESSING
    case BehaviourPlanner.PROCESSING:
      this.nextBlockIn = 2 + Math.random() * 2;
      // gaze
      var offsetDirections = ["UP_RIGHT", "UP_LEFT", "LEFT", "RIGHT"]; // Upper and sides
      var randOffset = offsetDirections[Math.floor(Math.random() * offsetDirections.length)];
      if(Math.random() < 0.8)
      {
        // block.gazeShift = {
        //   start: 0,
        //   end: 1 + Math.random(),
        //   influence: "EYES",
        //   target: "CAMERA",
        //   offsetDirection: randOffset,
        //   offsetAngle: 10 + 5*Math.random(),
        //   type:"gazeShift"
        // }
      }

      // head nods
      if (Math.random() < 0.3)
      {
        // block.head = {
        //   start: 0,
        //   end: 1.5 + Math.random()*2,
        //   lexeme: Math.random() < 0.2 ? "TILT" : "NOD",
        //   amount: 0.05 + Math.random()*0.1,
        //   type:"head"
        // }
      }

      // frown
      if (Math.random() < 0.6)
      {
        block.face = {
          start: 0,
          end: 1 + Math.random(),
          lexeme: [
            {
              lexeme: "BROW_LOWERER", 
              amount: 0.2 + Math.random()*0.5
            }
          ],
          type:"face"
        }
      }

      // press lips
      if (Math.random() < 0.3)
      {
        var lexeme = {
          lexeme: "LIP_PRESSOR",
          amount: 0.1 + 0.3 * Math.random()
        };
        if(block.face)
          block.face.lexeme.push(lexeme)
        else
          block.face = {
            start: 0,
            end: 1 + Math.random(),
            lexeme: lexeme
        }
          block.face.type="face"
      }
      break;
  
  // WAITING
    case BehaviourPlanner.WAITING:
      
      this.nextBlockIn = 2 + Math.random() * 3;
      // gaze
      var offsetDirections = ["CAMERA","DOWN", "DOWN_RIGHT", "DOWN_LEFT", "LEFT", "RIGHT"]; // Upper and sides
      var randOffset = offsetDirections[Math.floor(Math.random() * offsetDirections.length)];
      // block.gazeShift = {
      //   start: 0,
      //   end: 1 + Math.random(),
      //   target: "CAMERA",
      //   influence: Math.random()>0.5 ? "HEAD":"EYES",
      //   offsetDirection: offsetDirections[randOffset],
      //   offsetAngle: 5 + 5*Math.random(),
      //   type:"gazeShift"
      // }

      // Set to neutral face (VALENCE-AROUSAL)
      //block.faceShift = {start: 0, end: 2, valaro: [0,0], type:"faceShift"};
      block.composition = "MERGE"
     	break;
  }
  return block;
}

// -------------------- NEW BLOCK --------------------
// New block arrives. It could be speech or control.
BehaviourPlanner.prototype.newBlock = function(block){
  
  // State
  if ( block.control ){
    this.transition(block);
  }

	// If non-verbal -> inside mode-selection.nonverbal
	if (block.nonVerbal){
		// Add gesture (check arousal of message)
    if (block.nonVerbal.constructor === Array){ // It is always an array in server
      for (var i = 0; i < block.nonVerbal.length; i++){ // TODO -> relate nonVerbal with lg
        var act = block.nonVerbal[i].dialogueAct;
        block.gesture = {lexeme: act, start: 0, end: 2, type:"gesture"};
      }
    }
    
	}
}

// Automatic blink and saccades
// http://hal.univ-grenoble-alpes.fr/hal-01025241/document
BehaviourPlanner.prototype.updateBlinksAndSaccades = function(dt){
  // Minimum time between saccades 150ms
  // Commonly occurring saccades 5-10 deg durations 30-40ms
  // Saccade latency to visual target is 200ms (min 100 ms)
  // Frequency?
  
  // 10-30 blinks per minute during conversation (every two-six seconds)
  // 1.4 - 14 blinks per min during reading
  
  var block = null;
   
  // Saccade
  this.saccCountdown += dt;
  if (this.saccCountdown > this.saccIdle){
    // Random direction
    var opts = ["RIGHT", "LEFT", "DOWN","DOWN_RIGHT", "DOWN_LEFT", "UP", "UP_LEFT", "UP_RIGHT"]; // If you are looking at the eyes usually don't look at the hair
    var randDir = opts[Math.floor(Math.random()*opts.length)];
    
    // Fixed point to saccade around?
    var target = "CAMERA"//"EYESTARGET";
    if (this.state == BehaviourPlanner.LISTENING) 
      target = "CAMERA";
        
    if (!block) 
      block = {};
    
    // block.gaze = {
    //   start: 0,
    //   end: Math.random()*0.1+0.1,
    //   target: target, 
    //   influence: "EYES",
    //   offsetDirection: "CAMERA",
    //   offsetAngle: Math.random()*3 + 2,
    //   type:"gaze"
    // }
    
    this.saccCountdown = this.saccDur;
    if (this.state ==BehaviourPlanner.LISTENING || this.state == BehaviourPlanner.SPEAKING)
      this.saccIdle = this.saccDur + 2 + Math.random()*6;
    else
  		this.saccIdle = this.saccDur + 0.5 + Math.random()*6;
  	
    this.saccDur = Math.random()*0.5 + 0.5;
  }
  
  return block;
}


BehaviourPlanner.prototype.attentionToUser = function(block, overwrite){
  // If gazeShift already exists, modify
	var end = 0.5 + Math.random();
	var startHead = 0;
  var startGaze = startHead + Math.random()*0.5; // Late start
  
	// gazeShift
	// var gazeShift = {
  //   id: "gazeEnd",
	// 	start: startGaze,
	// 	end: end,
	// 	influence: "EYES",
	// 	target: "CAMERA",
  //   type:"gazeShift"
	// }
  
	// headDirectionShift
	var offsetDirections = ["CAMERA","DOWN", "DOWN_LEFT", "DOWN_RIGHT"]; // Submissive? Listening?
  var randOffset = offsetDirections[Math.floor(Math.random() * offsetDirections.length)];
	var startDir = -Math.random()*0.3;
	// var headDir = {
	// 	start: startHead,
	// 	end: end,
	// 	target: "CAMERA",
  //   offsetDirection: "CAMERA",
  //   offsetAngle: 2 + 5*Math.random(),
  //   type:"headDirectionShift"
	// }
  
  var faceVA = {
    start: startHead,
    end: end,
    valaro: [this.defaultValence, 0],
    type:"faceVA",
    shift : true
  }
  
  // Force and remove existing bml instructions
  if (overwrite)
  {
    //block.blink = blink;
    //block.faceVA = faceVA;
    // block.gazeShift = gazeShift;
    // block.headDirectionShift = headDir;
  } 
  else
  {
    //this.addToBlock(blink, block, "blink");
    //this.addToBlock(faceVA, block, "faceVA");
    // this.addToBlock(gazeShift, block, "gazeShift");
    // this.addToBlock(headDir, block, "headDirectionShift");
  }
}

BehaviourPlanner.prototype.addToBlock = function(bml, block, key){
  if (block[key])
  {
    // Add to array (TODO: overwrite, merge etc...)
    if (block[key].constructor === Array)
    {
      if (bml.constructor === Array)
        for (var i = 0; i<bml.length; i++)
          block[key].push(bml[i]);
      else
        block[key].push(bml);
    }
    // Transform object to array
    else {
      var tmpObj = block[key];
      block[key] = [];
      block[key].push(tmpObj);
      if (bml.constructor === Array)
        for (var i = 0; i<bml.length; i++)
          block[key].push(bml[i]);
       else
        block[key].push(bml);
    }
  } 
  // Doesn't exist yet
  else
    block[key] = bml;
  
}


// ---------------------------- NONVERBAL GENERATOR (for speech) ----------------------------
// Process language generation message
// Adds new bml instructions according to the dialogue act and speech
//BehaviourPlanner.prototype.processSpeechBlock = function (bmlLG, block, isLast){}

// Use longest word as prosody mark
//BehaviourPlanner.prototype.createBrowsUp = function (bmlLG){}

// Generate faceShifts at the end of speech
//BehaviourPlanner.prototype.createEndFace = function (bmlLG){}

// Create a head nod at the beggining
//BehaviourPlanner.prototype.createHeadNodStart = function (bmlLG){}

// Create gaze (one at start to look away and back to user)
//BehaviourPlanner.prototype.createGazeStart = function (bmlLG){}

// Look at the camera at the end
//BehaviourPlanner.prototype.createGazeEnd = function (bmlLG){}

// Change offsets of new bml instructions
//BehaviourPlanner.prototype.fixSyncStart = function (bml, offsetStart){}

// Add a pause between speeches
//BehaviourPlanner.prototype.addUtterancePause = function (bmlLG){}

//@BehaviorRealizer
let DEG2RAD = Math.PI / 180;
let RAD2DEG = 180 / Math.PI;

// --------------------- BLINK ---------------------
// BML
// <blink start attackPeak relax end amount>
function Blink( auto = true ) {
    
    this.start = 0;
    this.end = 0;
    this.elapsedTime = 0;
    this.initWs = [0, 0]; // initial pose of eyelids
    this.endWs = [0, 0]; // target pose of eyelids ( constantly changes during update )
    this.weights = [0, 0]; // current status

    this.state = 0x01; // 0 waiting, 0x01 needs init, 0x02 blinking -- flags
    this.auto = !!auto; // whether to automatically change the state from waiting to init (does not call "update" by itself)
    this.timeoutID = null; // this would not be necessary if timeout was not used
}

Blink.prototype.setAuto = function ( isAutomatic ){ 
    this.auto = !!isAutomatic;
    if ( this.auto && !this.state ){ this.state = 0x01; } // when auto == true, force start if it was stopped
}

Blink.prototype.reset = function (){ 
    if( this.auto ){ this.state = 0x01; }
    else{ this.state = 0x00; }
    if ( this.timeoutID ){ clearTimeout( this.timeoutID ); this.timeoutID = null; }
}

Blink.prototype.initBlinking = function (cw0, cw1) {
    
    if( this.state & 0x02 ){ // forced a blink while already executing one
        this.initWs[0] = this.weights[0]; this.initWs[1] = this.weights[1];
    }else{
        this.initWs[0] = cw0; this.initWs[1] = cw1;
        this.weights[0] = cw0; this.weights[1] = cw1;
    }
    this.endWs[0] = cw0; this.endWs[1] = cw1;
    
    this.elapsedTime = 0;
    this.start = 0;
    let lowestWeight = Math.min(cw0, cw1);
    lowestWeight = Math.min(1, Math.max(0, lowestWeight));
    this.end = 0.5 * (1 - lowestWeight);
    this.end = Math.max(this.end, this.start); // just in case

    this.state = 0x02;
}

Blink.prototype.blink = function () { this.state |= 0x01; }
Blink.prototype._timeoutBlink = function () { if ( this.auto ){ this.state |= 0x01; } this.timeoutID = null; }

Blink.prototype.update = function ( dt, currentWeight0, currentWeight1 ) {

    if ( this.state & 0x01 ) {
        this.initBlinking( currentWeight0, currentWeight1 );
    }
    if ( this.state && dt > 0 ) {
        this.elapsedTime += dt;
        this.endWs[0] = currentWeight0;
        this.endWs[1] = currentWeight1;

        this.computeWeight( this.elapsedTime );

        if (this.elapsedTime > this.end ) { // schedule next blink
            this.state = 0;
            if ( this.auto && !this.timeoutID ){ this.timeoutID = setTimeout( this._timeoutBlink.bind( this ), Math.random() * 3000 + 1500 ); }
            return;
        }
    }
}


//Paper --> Eye Movement Synthesis with 1/ f Pink Noise -- Andrew Duchowski∗, Sophie Jörg, Aubrey Lawson, Takumi Bolte, Lech Swirski  ́

// W(t) = -> a - (t/mu)^2 if t<=mu
//        -> b - e^(-w*log(t-mu+1)) otherwise
// where t = [0,100] normalized percent blink duration 
// mu = 37 when the lid should reach full closure
// a = 0.98 percent lid closure at the start of the blink
// b = 1.18 
// w = mu/100 parameters used to shape the asymptotic lid opening dunction

Blink.prototype.computeWeight = function (dt) {
    
    let t = (dt - this.start) / (this.end - this.start) * 100;
    t = Math.min(100, Math.max(0, t));
    let mu = 37;
    let a = 1;
    let b = 1.18;
    let c = mu / 100;
    let w = 0;
    let srcWs = null;
    if (t <= mu) {
        w = a - Math.pow(t / mu, 2);
        srcWs = this.initWs;
    } else {
        w = b - Math.pow(Math.E, (-c * Math.log2(t - mu + 1)));
        srcWs = this.endWs;
    }
    w = Math.min(1, Math.max(0, w));
    this.weights[0] = 1 - w * (1 - srcWs[0]);
    this.weights[1] = 1 - w * (1 - srcWs[1]);
}


// --------------------- FACIAL EXPRESSIONS ---------------------
// BML
// <face or faceShift start attackPeak relax* end* valaro
// <faceLexeme start attackPeak relax* end* lexeme amount
// <faceFacs not implemented>
// lexeme  [OBLIQUE_BROWS, RAISE_BROWS,
//      RAISE_LEFT_BROW, RAISE_RIGHT_BROW,LOWER_BROWS, LOWER_LEFT_BROW,
//      LOWER_RIGHT_BROW, LOWER_MOUTH_CORNERS,
//      LOWER_LEFT_MOUTH_CORNER,
//      LOWER_RIGHT_MOUTH_CORNER,
//      RAISE_MOUTH_CORNERS,
//      RAISE_RIGHT_MOUTH_CORNER,
//      RAISE_LEFT_MOUTH_CORNER, OPEN_MOUTH,
//      OPEN_LIPS, WIDEN_EYES, CLOSE_EYES]
//


// Static 
// first row = blendshape indices || second row = blendshape proportional amount (some blendshapes are slightly used, others are fully used)
FacialExpr.NMF = {}; // lookup table for lexeme-blendshape relation

// SignON actions units
// BROWS
FacialExpr.NMF.ARCH =                       [[1, 2, 0], [1, 1, 1]];
FacialExpr.NMF.BROW_LOWERER =               [[3, 4], [1,1]]; // AU4 brows down
FacialExpr.NMF.BROW_LOWERER_LEFT =          [[3], [1]]; // LAU4
FacialExpr.NMF.BROW_LOWERER_RIGHT =         [[4], [1]]; // RAU4 
FacialExpr.NMF.BROW_RAISER =                [[1, 2], [1,1]]; //  brow up
FacialExpr.NMF.BROW_RAISER_LEFT =           [[1], [1]]; // left brow up
FacialExpr.NMF.BROW_RAISER_RIGHT =          [[2], [1]]; // right brow up
FacialExpr.NMF.INNER_BROW_RAISER =          [[0], [1]]; // AU1 rows rotate outwards
FacialExpr.NMF.OUTER_BROW_RAISER =          [[1, 2], [1,1]]; // AU2 brows up (right)
// EYES
FacialExpr.NMF.SQUINT =                     [[49, 50], [1, 1]];
FacialExpr.NMF.BLINK =                      [[51, 52], [1, 1]]; // AU45 eyelids closed 
FacialExpr.NMF.EYES_CLOSED =                [[51, 52], [1, 1]]; // AU43 eyelids closed
FacialExpr.NMF.UPPER_LID_RAISER =           [[47, 48], [1,1]]; // AU5 negative eyelids closed /wide eyes
FacialExpr.NMF.UPPER_LID_RAISER_LEFT =      [[47], [1]]; // AU5 negative eyelids closed /wide eyes
FacialExpr.NMF.UPPER_LID_RAISER_RIGHT =     [[48], [1]]; // AU5 negative eyelids closed /wide eyes 
FacialExpr.NMF.LID_TIGHTENER =              [[51, 52, 49, 50], [0.2, 0.2, 0.8, 0.8]]; // AU7 or AU44 squint TODO NEW MAPPING: SQUINT + BLINK
FacialExpr.NMF.WINK_LEFT =                  [[53], [1]]; // AU46
FacialExpr.NMF.WINK_RIGHT =                 [[54], [1]]; // AU46
// CHEEKS
FacialExpr.NMF.CHEEK_RAISER =               [[41, 42], [1,1]]; // AU6 squint 
FacialExpr.NMF.CHEEK_SUCK =                 [[45, 46], [1, 1]]; // AU35
FacialExpr.NMF.CHEEK_SUCK_LEFT =            [[45], [1]]; // LAU35
FacialExpr.NMF.CHEEK_SUCK_RIGHT =           [[46], [1]]; // RAU35
FacialExpr.NMF.CHEEK_BLOW =                 [[43, 44], [1, 1]]; // AU33
FacialExpr.NMF.CHEEK_BLOW_LEFT =            [[43], [1]]; // LAU33
FacialExpr.NMF.CHEEK_BLOW_RIGHT =           [[44], [1]]; // RAU33
// NOSE
FacialExpr.NMF.NOSE_WRINKLER =              [[5, 6], [1, 1]]; // AU9
FacialExpr.NMF.NOSTRIL_DILATOR =            [[7], [1]];       // AU38 - nostril dilator
FacialExpr.NMF.NOSTRIL_COMPRESSOR =         [[8], [1]];       // AU39 - nostril compressor
// LIPS
FacialExpr.NMF.LIP_CORNER_DEPRESSOR =       [[15, 16], [1,1]]; // AU15 sad 
FacialExpr.NMF.LIP_CORNER_DEPRESSOR_LEFT =  [[15], [1]]; // LAU15 sad
FacialExpr.NMF.LIP_CORNER_DEPRESSOR_RIGHT = [[16], [1]]; // RAU15 sad
FacialExpr.NMF.LIP_CORNER_PULLER =          [[13, 14], [1,1]]; // AU12 happy
FacialExpr.NMF.LIP_CORNER_PULLER_LEFT =     [[13], [1]]; // LAU12 happy
FacialExpr.NMF.LIP_CORNER_PULLER_RIGHT =    [[14], [1]]; // RAU12 happy
FacialExpr.NMF.LIP_STRETCHER =               [[21, 22], [1,1]];// AU20
FacialExpr.NMF.LIP_FUNNELER =               [[23], [1]];     // AU22
FacialExpr.NMF.LIP_TIGHTENER =              [[19, 20, 24, 25], [1, 1, 0.3, 0.3]];     // AU23 TODO: PUCKERER + PRESSOR
FacialExpr.NMF.LIP_PUCKERER =               [[19, 20], [1,1]]; // AU18 mouth narrow
FacialExpr.NMF.LIP_PUCKERER_LEFT =          [[19], [1]]; // AU18L mouth narrow left
FacialExpr.NMF.LIP_PUCKERER_RIGHT =         [[20], [1]]; // AU18R mouth narrow right
FacialExpr.NMF.LIP_PRESSOR =                [[24, 25], [1,1]]; // AU24
FacialExpr.NMF.LIPS_PART =                  [[26], [1.0]]; //AU25
FacialExpr.NMF.LIP_SUCK =                   [[27, 28], [1,1]];// AU28
FacialExpr.NMF.LIP_SUCK_UPPER =             [[27], [1]];// AU28U upper lip in
FacialExpr.NMF.LIP_SUCK_LOWER =             [[28], [1]];// AU28D lower lip in 
FacialExpr.NMF.LOWER_LIP_DEPRESSOR =        [[17, 18], [1,1]]; // AU16
FacialExpr.NMF.LOWER_LIP_DEPRESSOR_LEFT =   [[17], [1]]; // LAU16
FacialExpr.NMF.LOWER_LIP_DEPRESSOR_RIGHT =  [[18], [1]]; // RAU16
FacialExpr.NMF.UPPER_LIP_RAISER =           [[11, 12], [1,1]]; // AU10
FacialExpr.NMF.UPPER_LIP_RAISER_LEFT =      [[11], [1]]; // AU10L
FacialExpr.NMF.UPPER_LIP_RAISER_RIGHT =     [[12], [1]]; // AU10R
FacialExpr.NMF.CHIN_RAISER =                [[40], [1]]; // AU17 mouth up
FacialExpr.NMF.DIMPLER =                    [[9, 10], [1, 1]]; // AU14
FacialExpr.NMF.DIMPLER_LEFT =               [[9], [1]]; // LAU14
FacialExpr.NMF.DIMPLER_RIGHT =              [[10], [1]]; // RAU14
FacialExpr.NMF.LIP_BITE =                   [[28, 35, 36], [1, 0.1, 0.05]]; // AU32
// MOUTH-JAW
FacialExpr.NMF.SMILE_TEETH =                [[13, 14, 35], [0.5, 0.5, 0.2]];
FacialExpr.NMF.SMILE_TEETH_WIDE =           [[13, 14, 35], [1, 1, 0.2]];
FacialExpr.NMF.SMILE_CLOSED =               [[13, 14], [1, 1]]; // same as LIP_CORNER_DEPRESSOR
FacialExpr.NMF.ROUND_OPEN =                 [[19, 20, 35], [0.7, 0.7, 0.7]];
FacialExpr.NMF.ROUND_CLOSED =               [[19, 20], [1, 1]]; // same as LIP_PUCKERER
FacialExpr.NMF.MOUTH_STRETCH =              [[35], [1]]; // AU27
FacialExpr.NMF.CLOSE_TIGHT =                [[28, 19, 20, 27], [1, 1, 1, 1]];
FacialExpr.NMF.JAW_DROP =                   [[36], [1]]; // AU26
FacialExpr.NMF.JAW_THRUST =                 [[37], [1]]; // AU29
FacialExpr.NMF.JAW_SIDEWAYS_LEFT =          [[38], [1]]; // AU30L
FacialExpr.NMF.JAW_SIDEWAYS_RIGHT =         [[39], [1]]; // AU30R
// TONGUE
FacialExpr.NMF.TONGUE_BULGE_LEFT =          [[32], [1]];       // LAU36
FacialExpr.NMF.TONGUE_BULGE_RIGHT =         [[33], [1]];       // RAU36
FacialExpr.NMF.TONGUE_UP =                  [[30], [1]];       // 
FacialExpr.NMF.TONGUE_SHOW =                [[31], [1]];       // AU19
FacialExpr.NMF.TONGUE_WIDE =                [[34], [1]];       // 
FacialExpr.NMF.LIP_WIPE =                   [[29], [1]];       // AU37
// NECK
FacialExpr.NMF.NECK_TIGHTENER =             [[55], [1]];       // AU21


// Constructor
function FacialExpr(faceData, shift) {
    
    this.transition = false;

    let lexemes = faceData.lexeme;

    // Init face lexemes 
    if ( !lexemes ) { return; }

    // faceLexeme
    if ( typeof (lexemes) == "string" ){ this.initFaceLexeme(faceData, shift, [faceData]); }
    else if( Array.isArray( lexemes ) ){ this.initFaceLexeme(faceData, shift, lexemes); } // Several lexemes inside face/faceShift (faceData.lexeme = [{}, {}]...)
    else if ( typeof( lexemes ) == "object" ){ this.initFaceLexeme(faceData, shift, [lexemes]); } // One lexeme object inside face/faceShift (faceData.lexeme = {lexeme:"RAISE_BROWS"; amount: 0.1})

}

// There can be several facelexemes working at the same time then? lexemes is an array of lexeme objects
FacialExpr.prototype.initFaceLexeme = function (faceData, shift, lexemes) {

    // Sync
    this.start = faceData.start || 0.0;
    this.end = faceData.end;

    if (!shift) {
        this.attackPeak = faceData.attackPeak || (this.end - this.start) * 0.25 + this.start;
        this.relax = faceData.relax || (this.end - this.attackPeak) / 2 + this.attackPeak;
    } else {
        this.end = faceData.end || faceData.attackPeak || 0.0;
        this.attackPeak = faceData.attackPeak || this.end;
        this.relax = 0;
    }

    // Initial blend shapes and targets
    // Choose the ones to interpolate
    this.indicesLex = [];
    this.targetLexBSW = [];
    this.currentLexBSW = [];

    let j = 0; // index of accepted lexemes
    for (let i = 0; i < lexemes.length; i++) {

        let lexemeStr = lexemes[i].lexeme;
        if (typeof (lexemeStr) !== "string") { lexemeStr = "NO_LEXEME"; }
        else{ lexemeStr = lexemeStr.toUpperCase(); }

        // does lexeme exist?
        if ( !FacialExpr.NMF[lexemeStr] ) {
            this.transition = false;
            this.time = this.end;
            console.warn("Facial lexeme not found:", lexemeStr, ". Please refer to the standard.");
            continue;
        }

        // FacialExpr.NMF[lexemeStr] returns array [ BlendshapeIndices, weights ]
        let indices = FacialExpr.NMF[lexemeStr][0]; // get only the blendshape indices
        let weights = FacialExpr.NMF[lexemeStr][1]; // get only the blendshape weights

        // Indices
        this.indicesLex[j] = indices;
        this.targetLexBSW[j] = [];
        this.currentLexBSW[j] = [];

        // ensure lexeme has an intensity
        let lexemeAmount = lexemes[i].amount;
        lexemeAmount = (isNaN(lexemeAmount) || lexemeAmount == null ) ? faceData.amount : lexemeAmount;
        lexemeAmount = (isNaN(lexemeAmount) || lexemeAmount == null ) ? 1 : lexemeAmount;

        // set initial and target blendshape values for this lexeme
        for (let e = 0; e < indices.length; ++e) {
            this.targetLexBSW[j][e] = lexemeAmount * weights[e];
            this.currentLexBSW[j][e] = 0;
        }

        j++;
    }

    // Start
    this.transition = true;
    this.time = 0;
}

FacialExpr.prototype.updateLexemesBSW = function (dt) {

    // Immediate change
    if (this.attackPeak == 0 && this.end == 0 && this.time == 0) {
        for (var i = 0; i < this.indicesLex.length; i++)
            for (var j = 0; j < this.indicesLex[i].length; j++)
                this.currentLexBSW[i][j] = this.targetLexBSW[i][j];

        // Increase time and exit
        this.time += dt;
        return;
    }

    // Time increase
    this.time += dt;

    // Wait for to reach start time
    if (this.time < this.start) { return; }

    let inter = 0;

    if (this.time < this.start) {
        // did not even start
        inter = 0;
    } else if (this.time < this.attackPeak) {
        // Trans 1 - intro
        inter = (this.time - this.start) / (this.attackPeak - this.start);
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;
    } else if (this.time < this.relax) {
        // Stay still from attackPeak to relax
        inter = 1;
    } else if (this.time < this.end) {
        // Trans 2 - outro
        inter = (this.time - this.relax) / (this.end - this.relax);
        inter = 1 - inter; // outro goes from target to 0
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;
    } else {
        // end
        inter = 0;
        this.transition = false;
    }

    // Interpolation
    for (var i = 0; i < this.indicesLex.length; i++) {
        for (var j = 0; j < this.indicesLex[i].length; j++) {
            this.currentLexBSW[i][j] = inter * this.targetLexBSW[i][j];
        }
    }
}


// ---------------------------------------- FacialEmotion ----------------------------------

// Variables for Valence Arousal

// Psyche Interpolation Table
/*FacialExpr.prototype._emotionsVAE = [0.000, 0.000,  0.000,  0.000,  0.000,  0.000,  0.000,  0.000,  0.000,  0.000,  0.000,
                            0.000,  1.000,  0.138,  1.00,  0.000,  0.675,  0.000,  0.056,  0.200,  0.116,  0.100,
                            0.500,  0.866,  0.000,  0.700,  0.000,  0.000,  0.000,  0.530,  0.000,  0.763,  0.000,
                            0.866,  0.500,  0.000,  1.000,  0.000,  0.000,  0.600,  0.346,  0.732,  0.779,  0.000,
                            1.000,  0.000,  0.065,  0.000,  0.344,  0.344,  0.700,  0.000,  0.000,  1.000,  -0.300,
                            0.866,  -0.500, 0.391,  0.570,  0.591,  0.462,  1.000,  0.000,  0.981,  0.077,  0.000,
                            0.500,  -0.866, 0.920,  0.527,  0.000,  0.757,  0.250,  0.989,  0.000,  0.366,  -0.600,
                            0.000,  -1.000, 0.527,  0.000,  0.441,  0.531,  0.000,  0.000,  1.000,  0.000,  0.600,
                            -0.707, -0.707, 1.000,  0.000,  0.000,  0.000,  0.500,  1.000,  0.000,  0.000,  0.600,
                            -1.000, 0.000,  0.995,  0.000,  0.225,  0.000,  0.000,  0.996,  0.000,  0.996,  0.200,
                            -0.707, 0.707,  0.138,  0.075,  0.000,  0.675,  0.300,  0.380,  0.050,  0.216,  0.300];*/

/* "valence", "arousal" ,"BLINK","CHEEK_RAISER", "LIP_CORNER_PULLER", "BROW_LOWERER", "DIMPLER", "OUTER_BROW_RAISER", "
UPPER_LID_RAISER", "JAW_DROP","LID_TIGHTENER", "LIP_STRETCHER","NOSE_WRINKLER", "LIP_CORNER_DEPRESSOR", "CHIN_RAISER", "LIP_CORNER_PULLER_RIGHT", "DIMPLER_RIGHT"*/
/*FacialExpr.prototype._emotionsVAE = [
  [0.95, 0.23 ,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0 ],//HAPPINESS
  [-0.81, -0.57, 0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,0 ], //SADNESS
  [0.22, 0.98, 0,0,0,1,0,1,1,1,0,0,0,0,0,0,0,0 ], //SURPRISED
  [-0.25, 0.98 ,0,0,0,1,1,1,1,1,1,1,0,0,0,0,0,0 ], //FEAR
  [-0.76, 0.64,0 , 0,0,0,1,0,1,0,1,0,1,0,0,0,0,0 ], //ANGER
  [-0.96, 0.23,0, 0,0,0,0,0,0,0,0,0,0,1,1,1,0,0 ], //DISGUST
  [-0.98, -0.21,0, 0,0,0,0,0,0,0,0,0,0,0,0,0,1,1 ], //CONTEMPT
  [0, 0 ,0, 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 ] //NEUTRAL
  ]*/

// VAE - Valence, Arousal, Expression(s)
FacialEmotion.prototype._emotionsVAE = [
    [//ANGRY
        -0.76, 0.64,
        [FacialExpr.NMF.BROW_LOWERER, 0.9],
        [FacialExpr.NMF.UPPER_LID_RAISER, 0.1],
        [FacialExpr.NMF.LID_TIGHTENER, 0.25],
        [FacialExpr.NMF.LIP_CORNER_DEPRESSOR, 0.3],
        [FacialExpr.NMF.NOSE_WRINKLER, 0.2]
    ],
    [//HAPPY
        0.95, 0.23,
        [FacialExpr.NMF.CHEEK_RAISER, 0.4],
        [FacialExpr.NMF.BROW_RAISER, 0.1],
        [FacialExpr.NMF.SMILE_CLOSED, 0.75]
    ],
    [//SAD
        -0.81, -0.57,
        [FacialExpr.NMF.INNER_BROW_RAISER, 0.8],
        [FacialExpr.NMF.BROW_LOWERER, 0.5],
        [FacialExpr.NMF.LIP_CORNER_DEPRESSOR, 0.5],
    ],
    [//SURPRISED
        0.22, 0.98,
        [FacialExpr.NMF.INNER_BROW_RAISER, 0.5],
        [FacialExpr.NMF.OUTER_BROW_RAISER, 0.5],
        [FacialExpr.NMF.UPPER_LID_RAISER, 0.3],
        [FacialExpr.NMF.LIP_PUCKERER, 0.3],
        [FacialExpr.NMF.JAW_DROP, 0.35],
        [FacialExpr.NMF.MOUTH_STRETCH, 0.1]
    ],
    [//SACRED
        -0.25, 0.98,
        [FacialExpr.NMF.INNER_BROW_RAISER, 1.0],
        [FacialExpr.NMF.BROW_LOWERER, 0.5],
        [FacialExpr.NMF.UPPER_LID_RAISER, 0.3],
        [FacialExpr.NMF.LIP_STRETCHER, 0.3],
        [FacialExpr.NMF.JAW_DROP, 0.3]
    ],
    [//DISGUSTED
        -0.96, 0.23,
        [FacialExpr.NMF.NOSE_WRINKLER, 0.35],
        [FacialExpr.NMF.BROW_LOWERER, 0.35],
        [FacialExpr.NMF.SQUINT, 0.5],
        [FacialExpr.NMF.LIP_CORNER_DEPRESSOR, 0.2],
        [FacialExpr.NMF.UPPER_LIP_RAISER, 0.3],
        [FacialExpr.NMF.LOWER_LIP_DEPRESSOR, 0.1]
    ],
    [//CONTEMPT
        -0.98, -0.21,
        [FacialExpr.NMF.LIP_CORNER_PULLER_LEFT, 0.7],
        [FacialExpr.NMF.DIMPLER_LEFT, 0.5]
    ],
    [
        0,0
    ]
]

function FacialEmotion(sceneBSW) {
    
    // The aim of this class is to contain the current emotion of the avatar. It is intended to be reused
    this.gridSize = 100; // 100 x 100
    this.precomputeVAWeights(this.gridSize); // this could be done as a static...

    this.transition = false;
    this.time = 0;

    this.sceneBSW = sceneBSW;

    // generate arrays for current, init and target. Current and init will be constantly swapped on initFaceVAlaro
    this.initialVABSW = [];
    this.targetVABSW = [];
    this.currentVABSW = [];
    if (sceneBSW) {
        this.currentVABSW = this.sceneBSW.slice();
    }
    else {
        this.currentVABSW = this._emotionsVAE[0].slice(2); // first two elements of emotions are valence and arousal
    }
    this.currentVABSW.fill(0);
    this.initialVABSW = this.currentVABSW.slice();
    this.targetVABSW = this.currentVABSW.slice();
    this.defaultVABSW = this.currentVABSW.slice();
}

FacialEmotion.prototype.reset = function () {
    
    this.currentVABSW.fill(0);
    this.initialVABSW.fill(0);
    this.targetVABSW.fill(0);
    this.defaultVABSW.fill(0);
    this.transition = false;
    this.time = 0;
}

FacialEmotion.prototype.precomputeVAWeights = function (gridsize = 100) {
    
    // generates a grid of gridSize size, where for each point it determines which emotion is closer and its distance

    // each emotion's valaro as point
    let valAroPoints = [];
    for (let count = 0; count < this._emotionsVAE.length; count++) {
        let point = new THREE.Vector2(this._emotionsVAE[count][0], this._emotionsVAE[count][1]); 
        valAroPoints.push(point);
    }
    let num_points = valAroPoints.length;
    let pos = new THREE.Vector2();

    // create grid
    let total_nums = 2 * gridsize * gridsize;
    this._precomputed_weights = new Float32Array(total_nums);
    let values = this._precomputed_weights;
    this._precomputed_weights_gridsize = gridsize;

    // for each point in grid
    for (var y = 0; y < gridsize; ++y)
        for (var x = 0; x < gridsize; ++x) {
            let nearest = -1;
            let min_dist = 100000;
            //normalize
            pos.x = x / gridsize;
            pos.y = y / gridsize;
            // center coords
            pos.x = pos.x * 2 - 1;
            pos.y = pos.y * 2 - 1;

            // which emotion is closer to this point and its distance
            for (var i = 0; i < num_points; ++i) {
                let dist = pos.distanceToSquared(valAroPoints[i]); 
                if (dist > min_dist)
                    continue;
                nearest = i;
                min_dist = dist;
            }

            values[2 * (x + y * gridsize)] = nearest;
            values[2 * (x + y * gridsize) + 1] = min_dist;
        }

    return values;
}

FacialEmotion.prototype.initFaceValAro = function (faceData, shift) {

    // Valence and arousal
    //let valaro = faceData.valaro || [0.1, 0.1];
    this.valaro = new THREE.Vector2().fromArray(faceData.valaro || [0.1, 0.1]);
    if (faceData.emotion) {
        let emotion = faceData.emotion.toUpperCase ? faceData.emotion.toUpperCase() : faceData.emotion;
        switch (emotion) {
            case "ANGER":
                this.valaro.fromArray(this._emotionsVAE[0].slice(0, 2));
                break;
            case "HAPPINESS":
                this.valaro.fromArray(this._emotionsVAE[1].slice(0, 2));
                break;
            case "SADNESS":
                this.valaro.fromArray(this._emotionsVAE[2].slice(0, 2));
                break;
            case "SURPRISE":
                this.valaro.fromArray(this._emotionsVAE[3].slice(0, 2));
                break;
            case "FEAR":
                this.valaro.fromArray(this._emotionsVAE[4].slice(0, 2));
                break;
            case "DISGUST":
                this.valaro.fromArray(this._emotionsVAE[5].slice(0, 2));
                break;
            case "CONTEMPT":
                this.valaro.fromArray(this._emotionsVAE[6].slice(0, 2));
                break;
            default: // "NEUTRAL"
                this.valaro.fromArray(this._emotionsVAE[7].slice(0, 2));
                break;
        }
    }

    // Normalize
    let magn = this.valaro.length();
    if ( magn > 1 ) {
        this.valaro.x /= magn;
        this.valaro.y /= magn;
    }

    // Sync
    this.start = faceData.start || 0.0;
    this.end = faceData.end;
    this.amount = faceData.amount || 1.0;
    if ( shift ) {
        this.attackPeak = faceData.attackPeak || this.end;
        this.relax = this.end = this.attackPeak + 1;//faceData.end || faceData.attackPeak || 0.0; // ignored "end" and "relax" on shift
    } else {
        this.attackPeak = faceData.attackPeak || (this.end - this.start) * 0.25 + this.start;
        this.relax = faceData.relax || (this.end - this.attackPeak) / 2 + this.attackPeak;
    }
    this.amount = isNaN(faceData.amount) ? 1 : faceData.amount;

    // Target blend shapes
    this.VA2BSW(this.valaro, shift);

    // Start
    this.transition = true;
    this.time = 0;
}

FacialEmotion.prototype.VA2BSW = function (valAro, shift) {

    let gridsize = this.gridSize;
    let blendValues = this.currentVABSW.slice();
    // blendValues.length = this._emotionsVAE[0].length - 2;
    blendValues.fill(0);

    // position in grid to check
    let pos = valAro.clone();

    //precompute VA points weight in the grid
    let values = this._precomputed_weights;

    // one entry for each emotion
    let weights = [];
    weights.length = this._emotionsVAE.length;
    weights.fill(0);

    let total_inside = 0;
    let pos2 = new THREE.Vector2(); 
    //for each position in grid, check if distance to pos is lower than distance to its nearest emotion
    for (let y = 0; y < gridsize; ++y) {
        for (let x = 0; x < gridsize; ++x) {
            //normalize
            pos2.x = x / gridsize;
            pos2.y = y / gridsize;
            //center
            pos2.x = pos2.x * 2 - 1;
            pos2.y = pos2.y * 2 - 1;

            let data_pos = (x + y * gridsize) * 2; // two values in each entry
            let point_index = values[data_pos];
            let point_distance = values[data_pos + 1];
            let is_inside = pos2.distanceToSquared(pos) < (point_distance + 0.001);//epsilon
            if (is_inside) {
                weights[point_index] += 1;
                total_inside++;
            }
        }
    }

    // average each emotion with respect to amount of points near this.valAro
    for (let i = 0; i < weights.length; ++i) {
        weights[i] /= total_inside;
        let emotion = this._emotionsVAE[i]; // [ val, aro, [FacialExpr.NMF.BROW_LOWERER, 0.5],[FacialExpr.NMF.BROW_LOWERER, 0.5],[FacialExpr.NMF.BROW_LOWERER, 0.5], .. ]
        for( let j = 2; j < emotion.length; j++ ){ 
            // [FacialExpr.NMF.BROW_LOWERER, 0.5]
            let expression = emotion[j][0]; // FacialExpr.NMF.BROW_LOWERER == [ [1,2], [1,1] ]
            let exprAmount = emotion[j][1];
            for( let k = 0; k < expression[0].length; k++ ){ // [1,2]
                blendValues[ expression[0][k] ] += expression[1][k] * exprAmount * weights[i]; 
            }
        }
    }

    // swap initial state and current state arrays
    for (let j = 0; j < blendValues.length; j++) {
        this.targetVABSW[j] = blendValues[j] * this.amount;
        this.initialVABSW[j] = this.currentVABSW[j]; // initial and current should be the same
        if ( shift ){ // change default pose if shift
            this.defaultVABSW[j] = this.targetVABSW[j]; 
        }
    }
}

FacialEmotion.prototype.updateVABSW = function (dt) {
    if( this.transition == false ){
        for (let j = 0; j < this.currentVABSW.length; j++)
            this.currentVABSW[j] = this.defaultVABSW[j];
        return;
    }
    
    // Time increase
    this.time += dt;

    // Wait for to reach start time
    if (this.time < this.start){
        return;
    }

    // Stay still during attackPeak to relax
    if (this.time > this.attackPeak && this.time < this.relax){
        return;
    }

    // End
    if (this.time >= this.end) {
        for (let j = 0; j < this.currentVABSW.length; j++)
            this.currentVABSW[j] = this.defaultVABSW[j];
        this.transition = false;
        return;
    }

    let inter = 0;
    // Trans 1
    if (this.time <= this.attackPeak) {
        inter = (this.time - this.start) / (this.attackPeak - this.start);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;
        // Interpolation
        for (let j = 0; j < this.targetVABSW.length; j++)
            this.currentVABSW[j] = this.initialVABSW[j] * (1 - inter) + this.targetVABSW[j] * inter;
        return;
    }

    // Trans 2
    if (this.time > this.relax && this.time < this.end) {
        inter = (this.time - this.relax) / (this.end - this.relax);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter) * 0.5 + 0.5;
        // Interpolation
        for (let j = 0; j < this.targetVABSW.length; j++)
           this.currentVABSW[j] = this.defaultVABSW[j] * (1 - inter) + this.targetVABSW[j] * inter;
        return;
    }
}


// --------------------- GAZE (AND HEAD SHIFT DIRECTION) ---------------------
// BML
// <gaze or gazeShift start ready* relax* end influence target offsetAngle offsetDirection>
// influence [EYES, HEAD, NECK, SHOULDER, WAIST, WHOLE, ...]
// offsetAngle relative to target
// offsetDirection (of offsetAngle) [RIGHT, LEFT, UP, DOWN, UP_RIGHT, UP_LEFT, DOWN_LEFT, DOWN_RIGHT]
// target [CAMERA, RIGHT, LEFT, UP, DOWN, UP_RIGHT, UP_LEFT, DOWN_LEFT, DOWN_RIGHT]
// Scene inputs: gazePositions (head and camera), lookAt objects

// Gaze manager (replace BML)
GazeManager.gazePositions = {   
    "RIGHT": new THREE.Vector3(-30, 2, 100), "LEFT": new THREE.Vector3(30, 2, 100),
    "UP": new THREE.Vector3(0, 20, 100), "DOWN": new THREE.Vector3(0, -20, 100),
    "UP_RIGHT": new THREE.Vector3(-30, 20, 100), "UP_LEFT": new THREE.Vector3(30, 20, 100),
    "DOWN_RIGHT": new THREE.Vector3(-30, -20, 100), "DOWN_LEFT": new THREE.Vector3(30, -20, 100),
    "FRONT": new THREE.Vector3(0, 2, 100), "CAMERA": new THREE.Vector3(0, 2, 100)
};

Gaze.prototype.gazeBS = {
    "RIGHT": { squint: 0, eyelids: 0 }, "LEFT": { squint: 0, eyelids: 0 },
    "UP": { squint: 0.3, eyelids: 0 }, "DOWN": { squint: 0, eyelids: 0.2 },
    "UP_RIGHT": { squint: 0.3, eyelids: 0 }, "UP_LEFT": { squint: 0.3, eyelids: 0 },
    "DOWN_RIGHT": { squint: 0, eyelids: 0.2 }, "DOWN_LEFT": { squint: 0, eyelids: 0.2 },
    "FRONT": { squint: 0, eyelids: 0 }, "CAMERA": { squint: 0, eyelids: 0 }, 
    "EYES_TARGET": { squint: 0, eyelids: 0 }, "HEAD_TARGET": { squint: 0, eyelids: 0 }, "NECK_TARGET": { squint: 0, eyelids: 0 }
};

// Constructor (lookAt objects and gazePositions)
function GazeManager(lookAtNeck, lookAtHead, lookAtEyes, gazePositions = null) {
    
    // Gaze positions
    this.gazePositions = gazePositions || GazeManager.gazePositions;

    // LookAt objects
    this.lookAtNeck = lookAtNeck;
    this.lookAtHead = lookAtHead;
    this.lookAtEyes = lookAtEyes;

    // Gaze Actions (could create here inital gazes and then recycle for memory efficiency)
    this.gazeActions = [null, null, null]; // eyes, head, neck
    this.gazeActions[0] = new Gaze(this.lookAtEyes, this.gazePositions, true);
    this.gazeActions[1] = new Gaze(this.lookAtHead, this.gazePositions, false);
    this.gazeActions[2] = new Gaze(this.lookAtNeck, this.gazePositions, false);
}

GazeManager.prototype.reset = function () {

    this.lookAtNeck.position.set(0, 2.5, 100);
    this.lookAtHead.position.set(0, 2.5, 100);
    this.lookAtEyes.position.set(0, 2.5, 100);

    this.gazeActions[0].reset();
    this.gazeActions[1].reset();
    this.gazeActions[2].reset();
}

// gazeData with influence, sync attr, target, offsets...
GazeManager.prototype.newGaze = function (gazeData, shift, gazePositions, headOnly) {

    // Gaze positions
    this.gazePositions = gazePositions || this.gazePositions;

    // Influence check, to upper case
    gazeData.influence = stringToUpperCase(gazeData.influence, "Gaze influence", "HEAD");


    // NECK requires adjustment of HEAD and EYES
    // HEAD requires adjustment of EYES
    switch (gazeData.influence) {
        case "NECK":
            this.gazeActions[2].initGazeData(gazeData, shift);
        case "HEAD":
            this.gazeActions[1].initGazeData(gazeData, shift);
        case "EYES":
            if (!headOnly)
                this.gazeActions[0].initGazeData(gazeData, shift);
        default: break;
    }
}

GazeManager.prototype.update = function (dt) {

    // Gaze actions update
    for (let i = 0; i < this.gazeActions.length; i++) {
        // If gaze exists (could inizialize empty gazes)
        if (this.gazeActions[i] && this.gazeActions[i].transition) {
            this.gazeActions[i].update(dt);
        }
    }

    return {
        eyelids: this.gazeActions[0].eyelidsW,
        squint: this.gazeActions[0].squintW
    };
}


// --------------------- GAZE (AND HEAD SHIFT DIRECTION) ---------------------

// Memory allocation of temporal arrays. Used only for some computations in initGazeValues
Gaze.prototype._tempQ = new THREE.Quaternion();
Gaze.prototype.targetP = new THREE.Vector3();

// Constructor
function Gaze(lookAt, gazePositions, isEyes = false) {

    this.isEyes = isEyes;

    // Gaze positions
    if (gazePositions) {
        this.gazePositions = gazePositions;
    }

    // Scene variables
    this.cameraEye = gazePositions["CAMERA"] || new THREE.Vector3();
    this.headPos = gazePositions["HEAD"] || new THREE.Vector3();
    this.lookAt = lookAt;

    // make it deactivated
    this.transition = false;
    this.eyelidsW = 0;
    this.squintW = 0;

    // Define initial and end positions
    this.src = { p: new THREE.Vector3(), squint: 0, lids: 0 };
    this.trg = { p: new THREE.Vector3(), squint: 0, lids: 0 };
    this.def = { p: gazePositions["FRONT"].clone(), squint: 0, lids: 0 };
}

Gaze.prototype.reset = function () {
    this.transition = false;
    this.eyelidsW = 0;
    this.squintW = 0;

    // Define initial and end positions
    this.src.p.set(0,0,0); this.src.squint = 0; this.src.lids = 0;
    this.trg.p.set(0,0,0); this.trg.squint = 0; this.trg.lids = 0;
    this.def.p.copy( this.gazePositions["FRONT"] ); this.def.squint = 0; this.def.lids = 0;
}


Gaze.prototype.initGazeData = function (gazeData, shift) {

    // Sync
    this.start = gazeData.start || 0.0;
    this.end = gazeData.end || 2.0;
    if (!shift) {
        this.ready = gazeData.ready || this.start + (this.end - this.start) / 3;
        this.relax = gazeData.relax || this.start + 2 * (this.end - this.start) / 3;
    } else {
        this.ready = this.end;
        this.relax = 0;
    }

    // Offset direction
    this.offsetDirection = stringToUpperCase(gazeData.offsetDirection, "Gaze offsetDirection", "RIGHT");

    // Target
    this.target = stringToUpperCase(gazeData.target, "Gaze target", "FRONT");

    // Angle
    this.offsetAngle = gazeData.offsetAngle || 0.0;

    // Start
    this.transition = true;
    this.time = 0;

    // Extension - Dynamic
    this.dynamic = gazeData.dynamic || false;

    //Blendshapes
    this.src.lids = this.eyelidsW;
    this.trg.lids = this.gazeBS[this.target].eyelids;
    this.src.squint = this.squintW;
    this.trg.squint = this.gazeBS[this.target].squint;

    // Define initial values
    this.initGazeValues();
    if ( shift ){ 
        this.def.p.copy( this.trg.p ); 
        this.def.lids = this.trg.lids;
        this.def.squint = this.trg.squint;
    }

}


Gaze.prototype.update = function (dt) {

    if ( !this.transition )
        return;
    
    // Time increase
    this.time += dt;

    // Wait for to reach start time
    if (this.time < this.start)
        return;

    // Stay still during ready to relax
    if (this.time > this.ready && this.time < this.relax){
        if (this.isEyes) {
            this.eyelidsW = this.trg.lids;
            this.squintW = this.trg.squint;
        }
        return;
    }

    // Extension - Dynamic (offsets do not work here)
    if (this.dynamic) {
        this.trg.p.copy(this.gazePositions[this.target]);
    }

    if ( this.time <= this.ready ){ 
        let inter = (this.time - this.start) / (this.ready - this.start); 
        inter = Math.sin(Math.PI * inter - Math.PI * 0.5) * 0.5 + 0.5;
        if (this.isEyes) {
            this.eyelidsW = this.src.lids * (1 - inter) + this.trg.lids * (inter);
            this.squintW = this.src.squint * (1 - inter) + this.trg.squint * (inter);
        }
        // lookAt pos change
        this.lookAt.position.lerpVectors(this.src.p, this.trg.p, inter);
        return;
    } 
    
    if ( this.time <= this.end ){
        let inter = (this.time - this.relax) / (this.end - this.relax);
        inter = Math.sin(Math.PI * inter - Math.PI * 0.5) * 0.5 + 0.5;
        if (this.isEyes) {
            this.eyelidsW = this.trg.lids * (1 - inter) + this.def.lids * (inter); // return to 0
            this.squintW = this.trg.squint * (1 - inter) + this.def.squint * (inter); // return to 0
        }
        // lookAt pos change
        this.lookAt.position.lerpVectors(this.trg.p, this.def.p, inter);
        return;
    }

    // End
    if (this.time > this.end) {
        // Extension - Dynamic
        if (this.dynamic) {
            this.lookAt.position.copy(this.def.p);
        }
        else {
            this.transition = false;
            this.lookAt.position.copy(this.def.p);
            this.eyelidsW = this.def.lids;
            this.squintW = this.def.squint;
        }
    }
}

Gaze.prototype.initGazeValues = function () {

    // Find target position (copy? for following object? if following object and offsetangle, need to recalculate all the time!)
    if (this.gazePositions && this.gazePositions[this.target]) {
        this.targetP.copy(this.gazePositions[this.target]);
    } else {
        this.targetP.set(0, 110, 100);
    }

    // Angle offset
    // Define offset angles (respective to head position?)
    // Move to origin
    let q = this._tempQ;
    let v = this.targetP.sub(this.headPos);
    let magn = v.length();
    v.normalize();
    this.trg.lids = this.gazeBS[this.target].eyelids;
    this.trg.squint = this.gazeBS[this.target].squint;
    // Rotate vector and reposition
    switch (this.offsetDirection) {
        case "UP_RIGHT":
            q.setFromAxisAngle(v, -25 * DEG2RAD);
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.offsetAngle * DEG2RAD);
            v.applyQuaternion(q);

            if (this.isEyes) {
                this.trg.squint *= Math.abs(this.offsetAngle / 30)
            }
            break;

        case "UP_LEFT":
            q.setFromAxisAngle(v, -75 * DEG2RAD);
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.offsetAngle * DEG2RAD);
            v.applyQuaternion(q);
            if (this.isEyes) {

                this.trg.squint *= Math.abs(this.offsetAngle / 30)
            }
            break;

        case "DOWN_RIGHT":
            q.setFromAxisAngle(v, -25 * DEG2RAD);
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.offsetAngle * DEG2RAD);
            v.applyQuaternion(q);
            if (this.isEyes) {
                this.trg.lids *= Math.abs(this.offsetAngle / 30)
            }
            break;

        case "DOWN_LEFT":
            q.setFromAxisAngle(v, 75 * DEG2RAD);
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.offsetAngle * DEG2RAD);
            v.applyQuaternion(q);
            if (this.isEyes) {
                this.trg.lids *= Math.abs(this.offsetAngle / 30)
            }
            break;

        case "RIGHT":
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.offsetAngle * DEG2RAD);
            break;

        case "LEFT":
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.offsetAngle * DEG2RAD);
            break;

        case "UP":
            v = new THREE.Vector3(1, 0, 0);
            q.setFromAxisAngle(v, -45 * DEG2RAD);
            v.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.offsetAngle * DEG2RAD);
            v.applyQuaternion(q);
            if (this.isEyes) {
                this.trg.squint *= Math.abs(this.offsetAngle / 30)
            }
            break;
        case "DOWN":
            /* quat.setAxisAngle(q, v, 45*DEG2RAD);//quat.setAxisAngle(q, v, 90*DEG2RAD);
             vec3.rotateY(v,v, this.offsetAngle*DEG2RAD);
             vec3.transformQuat(v,v,q);*/

            // let c = v.clone();
            // c.cross(new THREE.Vector3(0,1,0));
            // let q = new THREE.Quaternion();
            // q.setFromAxisAngle(c, this.offsetAngle*DEG2RAD)
            // //q.setFromAxisAngle(new, 0)//45*DEG2RAD);
            // //c.applyAxisAngle(c, this.offsetAngle*DEG2RAD);
            // v.applyQuaternion(q);
            // v.normalize()
            if (this.isEyes) {
                this.trg.lids *= Math.abs(this.offsetAngle / 30)
            }
            break;
    }
    
    // Move to head position and save modified target position
    v.addScaledVector(v, magn);
    v.addVectors(v, this.headPos);
    this.targetP.copy(v)

    if (!this.lookAt || !this.lookAt.position)
        return console.log("ERROR: lookAt not defined ", this.lookAt);

    // Define initial and end positions
    this.src.p.copy( this.lookAt.position );
    this.trg.p.copy( this.targetP ); // why copy? targetP shared with several?
}


// --------------------- HEAD ---------------------
// BML
// <head start ready strokeStart stroke strokeEnd relax end lexeme repetition amount>
// lexeme [NOD, SHAKE, TILT, TILT_LEFT, TILT_RIGHT, TILT_FORWARD, TILT_BACKWARD, FORWARD, BACKWARD]
// repetition cancels stroke attr
// amount how intense is the head nod? 0 to 1

// head nods will go slightly up -> position = ready&stroke_start and stroke_end&relax
// Should work together with gaze. Check how far is from the top-bottom angle limits or right-left angle limits
// Scene inputs: head bone node, neutral rotation and lookAtComponent rotation
// Combination of gaze and lookAtComponent:
//if (this.headBML.transition){
//  this._lookAtHeadComponent.applyRotation = false;
//  this.headBML.update(dt);
//} else
//  this._lookAtHeadComponent.applyRotation = true;

// Constructor
// headNode is to combine gaze rotations and head behavior
function HeadBML(headData, headNode, lookAtRot, limVert, limHor) {

    // Rotation limits (from lookAt component for example)
    this.limVert = Math.abs(limVert) || 20;
    this.limHor = Math.abs(limHor) || 30;

    // Scene variables
    this.headNode = headNode;
    this.lookAtRot = new THREE.Quaternion(lookAtRot.x, lookAtRot.y, lookAtRot.z, lookAtRot.w);

    // Init variables
    this.initHeadData(headData);
}

// Init variables
HeadBML.prototype.initHeadData = function (headData) {
    
    // start -> ready -> strokeStart -> stroke -> strokeEnd -> relax -> end

    headData.lexeme = stringToUpperCase(headData.lexeme, "Head lexeme", "NOD");

    // Lexeme, repetition and amount
    this.lexeme = headData.lexeme || "NOD";
    this.amount = headData.amount || 0.2;

    // Maximum rotation amplitude
    if (this.lexeme == "NOD" || this.lexeme == "TILT_LEFT" || this.lexeme == "TILT_RIGHT" || this.lexeme == "TILT_FORWARD" || this.lexeme == "TILT_BACKWARD" || this.lexeme == "FORWARD" || this.lexeme == "BACKWARD")
        this.maxDeg = this.limVert * 2;
    else
        this.maxDeg = this.limHor * 2;

    // Sync start ready strokeStart stroke strokeEnd relax end
    this.start = headData.start || 0;
    this.end = headData.end || 2.0;

    this.ready = headData.ready || headData.strokeStart || (this.end / 4);
    this.relax = headData.relax || headData.strokeEnd || (this.end * 3 / 4);

    this.strokeStart = headData.strokeStart || this.ready;
    this.strokeEnd = headData.strokeEnd || this.relax;


    this.repetition = (isNaN(headData.repetition)) ? 0 : Math.abs(headData.repetition);
    this.repeatedIndx = 0;

    // Modify stroke and strokeEnd with repetition
    this.strokeEnd = this.strokeStart + (this.strokeEnd - this.strokeStart) / (1 + this.repetition)
    this.stroke = (this.strokeStart + this.strokeEnd) / 2;

    // Start
    this.transition = true;
    this.phase = 0;
    this.time = 0;

    this.currentAngle = 0;
    // Define initial values
    this.initHeadValues();
}

HeadBML.prototype.initHeadValues = function () {

    // Head initial rotation
    this.inQ = this.headNode.quaternion.clone();

    // Compare rotations to know which side to rotate
    // Amount of rotation
    var neutralInv = this.lookAtRot.clone().invert();
    var rotAmount = neutralInv.clone();
    rotAmount.multiply(this.inQ);
    var eulerRot = new THREE.Euler().setFromQuaternion(rotAmount);

    // X -> right(neg) left(pos)
    // Z -> up(neg) down(pos)

    // in here we choose which side to rotate and how much according to limits
    // the lookAt component should be stopped here (or set to not modify node, only final lookAt quat output)
    this.strokeAxis = new THREE.Vector3(1, 0, 0);
    this.strokeDeg = 0; // degrees of stroke
    this.readyDeg = 0; // ready will have some inertia in the opposite direction of stroke 

    switch ( this.lexeme ) {
        case "NOD":
            // nod will always be downwards
            this.strokeAxis.set(1, 0, 0);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.5;

            // If the stroke rotation passes the limit, change readyDeg
            if (eulerRot.z * RAD2DEG + this.strokeDeg > this.limVert)
                this.readyDeg = this.strokeDeg - this.limVert + eulerRot.z * RAD2DEG;
            break;
        
        case "SHAKE":
            this.strokeAxis.set(0, 1, 0);

            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.5;

            // Sign (left rigth)
            this.RorL = Math.sign(eulerRot.y) ? Math.sign(eulerRot.y) : 1;
            this.readyDeg *= -this.RorL;
            this.strokeDeg *= -this.RorL;
            break;
    
        case "TILT":
            this.strokeAxis.set(0, 0, 1);
            this.strokeDeg = this.amount * 20;
            this.readyDeg = this.strokeDeg * 0.5;
            break;
    
        case "ROTATE_LEFT":
            this.strokeAxis.set(0, -1, 0);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;
        
        case "ROTATE_RIGHT":
            this.strokeAxis.set(0, 1, 0);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;

        case "TILT_LEFT":
            this.strokeAxis.set(0, 0, 1);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;

        case "TILT_RIGHT":
            this.strokeAxis.set(0, 0, -1);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;
        
        case "TILT_FORWARD":
            this.strokeAxis.set(-1, 0, 0);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;

        case "TILT_BACKWARD":
            this.strokeAxis.set(1, 0, 0);
            this.strokeDeg = this.amount * this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;
            
        case "FORWARD":
            // nod will always be downwards
            this.strokeAxis.set(-1, 0, 0);
            this.strokeDeg = this.amount * this.maxDeg ;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;

        case "BACKWARD":
            // nod will always be downwards
            this.strokeAxis.set(1, 0, 0);
            this.strokeDeg = this.amount *  this.maxDeg;
            this.readyDeg = this.strokeDeg * 0.8;
            if(!this.repetition) {
                
                this.strokeStart = this.ready;
                this.strokeEnd = this.relax;
            }
            break;
    }

    this.currentStrokeQuat = new THREE.Quaternion(); this.currentStrokeQuat.setFromAxisAngle(this.strokeAxis, 0); // current state of rotation
}


HeadBML.prototype.update = function (dt) {

    // Time increase
    this.time += dt;
    let inter = 0;
    // Wait for to reach start time
    if (this.time < this.start)
        return;

    // Repetition -> Redefine strokeStart, stroke and strokeEnd before update
    if (this.time < this.relax && this.time >= this.strokeEnd && this.repeatedIndx < this.repetition) {
        this.repeatedIndx++;
        let timeRep = (this.strokeEnd - this.strokeStart);
        this.strokeStart = this.strokeEnd;
        this.strokeEnd += timeRep;
        this.stroke = (this.strokeEnd + this.strokeStart) / 2;

        this.phase = 0;
    }

    // Ready
    if (this.time <= this.ready) {
        inter = (this.time - this.start) / (this.ready - this.start);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;

        this.currentAngle = -this.readyDeg * inter;
        this.currentStrokeQuat.setFromAxisAngle(this.strokeAxis, this.currentAngle * DEG2RAD);
    }

    // StrokeStart
    else if (this.time > this.ready && this.time < this.strokeStart) {
        return;
    }

    // Stroke (phase 1)
    else if (this.time >= this.strokeStart && this.time <= this.stroke ) {
        inter = (this.time - this.strokeStart) / (this.stroke - this.strokeStart);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;

        if (this.phase != 1 ) {
            if(this.repeatedIndx >= this.repetition && this.lexeme != "TILT" && this.lexeme != "NOD" && this.lexeme != "SHAKE" )
                return;
            this.phase = 1;
        }

        this.currentAngle = -this.readyDeg + inter * this.strokeDeg;
        this.currentStrokeQuat.setFromAxisAngle(this.strokeAxis, this.currentAngle * DEG2RAD);
    }

    // Stroke (phase 2)
    else if (this.time > this.stroke && this.time <= this.strokeEnd && this.repeatedIndx < this.repetition) {
        inter = (this.time - this.stroke) / (this.strokeEnd - this.stroke);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;

        if (this.phase != 2) {
            this.phase = 2;
        }

        this.currentAngle = -this.readyDeg + ( 1 - inter ) * this.strokeDeg;
        this.currentStrokeQuat.setFromAxisAngle(this.strokeAxis, this.currentAngle * DEG2RAD);
    }
   
    // StrokeEnd (no repetition)
    else if (this.time >= this.strokeEnd && this.time < this.relax) {
        return;
    }

    // Relax -> Move towards lookAt final rotation
    else if (this.time > this.relax && this.time <= this.end) {
        inter = (this.time - this.relax) / (this.end - this.relax);
        // Cosine interpolation
        inter = Math.cos(Math.PI * inter + Math.PI) * 0.5 + 0.5;
        this.currentStrokeQuat.setFromAxisAngle(this.strokeAxis, (1-inter) * this.currentAngle * DEG2RAD);
    }

    // End
    else if (this.time > this.end) {
        this.currentStrokeQuat.set(0,0,0,1);
        this.transition = false
        return;
    }

}

// Turn to upper case and error check
var stringToUpperCase = function (item, textItem, def) {
    // To upper case
    if (Object.prototype.toString.call(item) === '[object String]')
        return item.toUpperCase();
    else { // No string
        //console.warn(textItem + " not defined properly.", item);
        return def;
    }
}

// --------------------- LIPSYNC MODULE --------------------

// // Switch to https if using this script
// if (window.location.protocol != "https:")
//     window.location.href = "https:" + window.location.href.substring(window.location.protocol.length);

// // Audio context
// if (!Lipsync.AContext)
// Lipsync.AContext = new AudioContext();

// Audio sources

Lipsync.prototype.refFBins = [0, 500, 700, 3000, 6000];

// Constructor
function Lipsync(threshold, smoothness, pitch) {

    // Freq analysis bins, energy and lipsync vectors
    this.energy = [0, 0, 0, 0, 0, 0, 0, 0];
    this.BSW = [0, 0, 0]; //kiss,lipsClosed,jaw

    // Lipsync parameters
    this.threshold = threshold || 0.0;
    this.dynamics = 30;
    this.maxDB = -30;

    this.smoothness = smoothness || 0.6;
    this.pitch = pitch || 1;
    // Change freq bins according to pitch
    this.fBins = [];
    this.defineFBins(this.pitch);

    // Initialize buffers
    this.init();

    // Output .csv (debug)
    //this.outstr = "time, e0, e1, e2, e3, bs_kiss, bs_lips_closed, bs_jaw\n";

    this.working = false;
}

// Start mic input
Lipsync.prototype.start = function (URL) {

    // Audio context
    if (!Lipsync.AContext)
        Lipsync.AContext = new AudioContext();
    // Restart
    this.stopSample();

    thatLip = this;
    if (URL === undefined) {
        /* navigator.getUserMedia({audio: true}, function(stream) {
          thatLip.stream = stream;
          thatLip.sample = thatLip.context.createMediaStreamSource(stream);
          thatLip.sample.connect(thatLip.analyser);
          console.log("Mic sampling rate:", thatLip.context.sampleRate);
          thatLip.analyser.disconnect();
          thatLip.gainNode.disconnect();
          thatLip.working = true;
        }, function(e){console.error("ERROR: get user media: ", e);});*/
    } else {
        this.loadSample(URL);
    }
}

Lipsync.prototype.loadBlob = function (blob) {

    // Audio context
    if (Lipsync.AContext)
        Lipsync.AContext.resume();
    const fileReader = new FileReader()

    // Set up file reader on loaded end event
    fileReader.onloadend = () => {

        const arrayBuffer = fileReader.result;
        var that = this;
        this.context.decodeAudioData(arrayBuffer,
            function (buffer) {
                //LGAudio.cached_audios[URL] = buffer;
                that.stopSample();

                that.sample = Lipsync.AContext.createBufferSource();
                that.sample.buffer = buffer;
                console.log("Audio loaded");
                that.playSample();
            }, function (e) { console.log("Failed to load audio"); });
    };

    //Load blob
    fileReader.readAsArrayBuffer(getBlobURL(blob))
}

Lipsync.prototype.loadSample = function (inURL) {
    
    var URL = LS.RM.getFullURL(inURL);

    if (LGAudio.cached_audios[URL] && URL.indexOf("blob:") == -1) {
        this.stopSample();
        this.sample = Lipsync.AContext.createBufferSource();
        this.sample.buffer = LGAudio.cached_audios[URL];
        this.playSample();
    } else {
        var request = new XMLHttpRequest();
        request.open('GET', URL, true);
        request.responseType = 'arraybuffer';

        var that = this;
        request.onload = function () {
            that.context.decodeAudioData(request.response,
                function (buffer) {
                    LGAudio.cached_audios[URL] = buffer;
                    that.stopSample();
                    that.sample = Lipsync.AContext.createBufferSource();
                    that.sample.buffer = buffer;
                    console.log("Audio loaded");
                    that.playSample();
                }, function (e) { console.log("Failed to load audio"); });
        };

        request.send();
    }
}

Lipsync.prototype.playSample = function () {

    // Sample to analyzer
    this.sample.connect(this.analyser);
    // Analyzer to Gain
    this.analyser.connect(this.gainNode);
    // Gain to Hardware
    this.gainNode.connect(this.context.destination);
    // Volume
    this.gainNode.gain.value = 1;
    console.log("Sample rate: ", this.context.sampleRate);
    var that = this;
    this.working = true;
    this.sample.onended = function () { that.working = false; };
    // start
    this.sample.start(0);
    //this.sample.loop = true;

    // Output stream (debug)
    //this.timeStart = thiscene.time;
    //this.outstr = "time, e0, e1, e2, e3, bs_kiss, bs_lips_closed, bs_jaw\n";
}

// Update lipsync weights
Lipsync.prototype.update = function () {

    if (!this.working)
        return;

    // FFT data
    if (!this.analyser) {
        //if (this.gainNode){
        // Analyser
        this.analyser = this.context.createAnalyser();
        // FFT size
        this.analyser.fftSize = 1024;
        // FFT smoothing
        this.analyser.smoothingTimeConstant = this.smoothness;

        //}
        //else return;
    }

    // Short-term power spectrum
    this.analyser.getFloatFrequencyData(this.data);

    // Analyze energies
    this.binAnalysis();
    // Calculate lipsync blenshape weights
    this.lipAnalysis();
}

Lipsync.prototype.stop = function (dt) {
    
    // Immediate stop
    if (dt === undefined) {
        // Stop mic input
        this.stopSample();

        this.working = false;
    }
    // Delayed stop
    else {
        thatLip = this;
        setTimeout(thatLip.stop.bind(thatLip), dt * 1000);
    }
}

// Define fBins
Lipsync.prototype.defineFBins = function (pitch) {
    
    for (var i = 0; i < this.refFBins.length; i++)
        this.fBins[i] = this.refFBins[i] * pitch;
}

// Audio buffers and analysers
Lipsync.prototype.init = function () {

    // Audio context
    if (!Lipsync.AContext)
        Lipsync.AContext = new AudioContext();
    var context = this.context = Lipsync.AContext;
    // Sound source
    this.sample = context.createBufferSource();
    // Gain Node
    this.gainNode = context.createGain();
    // Analyser
    this.analyser = context.createAnalyser();
    // FFT size
    this.analyser.fftSize = 1024;
    // FFT smoothing
    this.analyser.smoothingTimeConstant = this.smoothness;
    // FFT buffer
    this.data = new Float32Array(this.analyser.frequencyBinCount);
}

// Analyze energies
Lipsync.prototype.binAnalysis = function () {

    // Signal properties
    var nfft = this.analyser.frequencyBinCount;
    var fs = this.context.sampleRate;

    var fBins = this.fBins;
    var energy = this.energy;

    // Energy of bins
    for (var binInd = 0; binInd < fBins.length - 1; binInd++) {
        // Start and end of bin
        var indxIn = Math.round(fBins[binInd] * nfft / (fs / 2));
        var indxEnd = Math.round(fBins[binInd + 1] * nfft / (fs / 2));

        // Sum of freq values
        energy[binInd] = 0;
        for (var i = indxIn; i < indxEnd; i++) {
            // Power Spectogram
            //var value = Math.pow(10, this.data[i]/10);
            // Previous approach
            var value = 0.5 + (this.data[i] + 20) / 140;
            if (value < 0) value = 0;
            energy[binInd] += value;
        }
        // Divide by number of sumples
        energy[binInd] /= (indxEnd - indxIn);
        // Logarithmic scale
        //energy[binInd] = 10*Math.log10(energy[binInd] + 1E-6);
        // Dynamic scaling
        //energy[binInd] = ( energy[binInd] - this.maxDB)/this.dynamics + 1 - this.threshold;
    }
}

// Calculate lipsyncBSW
Lipsync.prototype.lipAnalysis = function () {

    var energy = this.energy;

    if (energy !== undefined) {

        var value = 0;

        // Kiss blend shape
        // When there is energy in the 1 and 2 bin, blend shape is 0
        value = (0.5 - (energy[2])) * 2;
        if (energy[1] < 0.2)
            value = value * (energy[1] * 5)
        value = Math.max(0, Math.min(value, 1)); // Clip
        this.BSW[0] = value;

        // Lips closed blend shape
        value = energy[3] * 3;
        value = Math.max(0, Math.min(value, 1)); // Clip
        this.BSW[1] = value;

        // Jaw blend shape
        value = energy[1] * 0.8 - energy[3] * 0.8;
        value = Math.max(0, Math.min(value, 1)); // Clip
        this.BSW[2] = value;
    }
}

// Stops mic input
Lipsync.prototype.stopSample = function () {
    
    // If AudioBufferSourceNode has started
    if (this.sample)
        if (this.sample.buffer)
            this.sample.stop(0);

    // If microphone input
    if (this.stream) {
        var tracks = this.stream.getTracks();
        for (var i = 0; i < tracks.length; i++)
            if (tracks[i].kind = "audio")
                tracks[i].stop();
        this.stream = null;
    }
}

function getBlobURL(arrayBuffer) {
    var i, l, d, array;
    d = arrayBuffer;
    l = d.length;
    array = new Uint8Array(l);
    for (var i = 0; i < l; i++) {
        array[i] = d.charCodeAt(i);
    }
    var b = new Blob([array], { type: 'application/octet-stream' });
    // let blob = blobUtil.arrayBufferToBlob(arrayBuffer, "audio/wav")
    return b
}


// ------------------------ TEXT TO LIP --------------------------------------------

function Text2LipInterface() {
    
    let _ = new Text2Lip();

    this.start = _.start.bind( _ );
    this.stop = _.stop.bind( _ );
    this.pause = _.pause.bind( _ );
    this.resume = _.resume.bind( _ );

    this.update = _.update.bind( _ );

    this.setEvent = _.setEvent.bind( _ );
    this.setTables = _.setTables.bind( _ );
    this.setDefaultSpeed = _.setDefaultSpeed.bind( _ );
    this.setDefaultIntensity = _.setDefaultIntensity.bind( _ );
    this.setSourceBSWValues = _.setSourceBSWValues.bind( _ );

    this.getDefaultSpeed = _.getDefaultSpeed.bind( _ );
    this.getDefaultIntensity = _.getDefaultIntensity.bind( _ );
    this.getCurrentIntensity = _.getCurrentIntensity.bind( _ );


    this.getSentenceDuration = _.getSentenceDuration.bind( _ ); // THE ONLY REASON THIS IS NOT STATIC IS BECAUSE IT USES this.DEFAULT_SPEED   
    this.cleanQueueSentences = _.cleanQueueSentences.bind( _ );
    this.pushSentence = _.pushSentence.bind( _ );

    this.getBSW = function () { return _.BSW; }

    this.getCompactState = _.getCompactState.bind( _ );
    this.isWorking = _.isWorking.bind( _ );
    this.isPaused = _.isPaused.bind( _ );
    this.needsSentences = _.needsSentences.bind( _ );
    this.getNumSentences = _.getNumSentences.bind( _ );
    this.getMaxNumSentences = _.getMaxNumSentences.bind( _ );
}

function Text2Lip() {
    
    this.DEFAULT_SPEED = 8; // phonemes/s
    this.DEFAULT_INTENSITY = 0.5; // [0,1]

    // tables ( references )
    this.lowerBoundVisemes = null;
    this.upperBoundVisemes = null;
    this.coarts = null;
    this.ph2v = null;
    this.numShapes = 0;

    // manages display of a sentence
    this.working = false;
    this.paused = false;
    this.speed = this.DEFAULT_SPEED; // phonemes/s
    this.intensity = this.DEFAULT_INTENSITY; // [0,1]
    this.text = "";
    this.currTargetIdx = 0; // current target character (aka when t=1 during interpolation, this char is shown)
    this.currT = 0; // current time of interpolation
    this.useCoarticulation = true;
    this.delay = 0;

    // variables for managing list of sentences to display
    this.currSent = null;
    this.queueIdx = 0;
    this.queueSize = 0;
    this.sentenceQueue = new Array( Text2Lip.QUEUE_MAX_SIZE );
    this.sentenceIDCount = 1; // when pushing, a 0 will mean failure. Start IDs at 1

    // blendshape weights. User can use this to do mouthing
    this.BSW = new Float32Array( this.numShapes ); this.BSW.fill( 0 );

    // needed because of coarticulation
    this.currV = new Float32Array( this.numShapes ); this.currV.fill( 0 );
    this.targV = new Float32Array( this.numShapes ); this.targV.fill( 0 ); // next visem - target

    // event listeners
    this.onIdle = null;
    this.onSentenceEnd = null; // receives ended sentence
    this.onSentenceStart = null; // receives starting sentence

    // default setup
    this.setTables( T2LTABLES.PhonemeToViseme, T2LTABLES.Coarticulations, T2LTABLES.LowerBound, T2LTABLES.UpperBound );
}

Text2Lip.prototype.setDefaultSpeed = function ( speed ) {
    if ( typeof ( speed ) === 'number' && speed > 0.001 ) {
        this.DEFAULT_SPEED = speed;
        return true;
    }
    return false;
};

Text2Lip.prototype.setDefaultIntensity = function ( intensity ) {
    if ( typeof ( intensity ) === 'number' ) {
        this.DEFAULT_INTENSITY = Math.max( 0.0, Math.min( 1.0, intensity ) );
        return true;
    }
    return false;
};

Text2Lip.prototype.setSourceBSWValues = function ( values ) {
    // values is only a number
    if ( typeof ( values ) == "number" ) {
        for ( let i = 0; i < this.currV.length; ++i ) {
            this.currV[ i ] = values;
        }
        return;
    }

    // values is an array
    for ( let i = 0; i < this.BSW.length && i < values.length; ++i ) {
        let value = ( typeof ( values[ i ] ) == "number" ) ? values[ i ] : 0.0;
        this.currV[ i ] = value;
    }
}

Text2Lip.prototype.setEvent = function ( eventType, fun ) {
    if ( typeof ( fun ) !== 'function' ) { return false; }
    switch ( eventType ) {
        case "onIdle": this.onIdle = fun; break;
        case "onSentenceEnd": this.onSentenceEnd = fun; break;
        case "onSentenceStart": this.onSentenceStart = fun; break;
        default: return false;
    }
    return true;
}

Text2Lip.prototype.setTables = function ( phonemeToViseme, coarts, lowerBoundVisemes, upperBoundVisemes = null ) {
    this.lowerBoundVisemes = lowerBoundVisemes;
    this.upperBoundVisemes = ( upperBoundVisemes && upperBoundVisemes.length > 0 ) ? upperBoundVisemes : lowerBoundVisemes;
    this.coarts = coarts;
    this.ph2v = phonemeToViseme;

    this.numShapes = 0
    if ( lowerBoundVisemes && lowerBoundVisemes.length > 0 ) {
        this.numShapes = lowerBoundVisemes[ 0 ].length;
    }

    this.BSW = new Float32Array( this.numShapes ); this.BSW.fill( 0 );
    this.currV = new Float32Array( this.numShapes ); this.currV.fill( 0 );
    this.targV = new Float32Array( this.numShapes ); this.targV.fill( 0 ); // next visem - target
}

Text2Lip.prototype.getDefaultSpeed = function () { return this.DEFAULT_SPEED; }
Text2Lip.prototype.getDefaultIntensity = function () { return this.DEFAULT_INTENSITY; }
Text2Lip.prototype.getCurrentIntensity = function () { return this.getIntensityAtIndex( this.currTargetIdx ); }

Text2Lip.prototype.getIntensityAtIndex = function ( index ) {
    if ( this.currSent ) {
        if ( index >= 0 && index < this.currSent.text.length ) {
            let phInt = this.currSent.phInt;
            if ( phInt && index < phInt.length ) { return phInt[ index ]; }
            else if ( this.currSent.sentInt !== null ) { return this.currSent.sentInt; }
        }
    }
    return this.DEFAULT_INTENSITY;
}

/**
* 
* @param {*} phoneme 
* @param {Array} outResult if not null, result will be written to this array. Otherwise a new array is generated with the resulting values and returned 
* @returns returns outResult or a new Float32Array
*/
Text2Lip.prototype.getViseme = function ( phoneme, outResult = null, ) {
    // this handles properly undefined and nulls.
    if ( !( phoneme in this.ph2v ) ) { return this.lowerBoundVisemes[ 0 ]; } // assuming there are visemes
    let visIdx = this.ph2v[ phoneme ];
    if ( visIdx < 0 || visIdx >= this.lowerBoundVisemes.length ) { return this.lowerBoundVisemes[ 0 ]; } // assuming there are visemes

    let lower = this.lowerBoundVisemes[ visIdx ];
    let upper = this.upperBoundVisemes[ visIdx ];

    let result = ( outResult ) ? outResult : ( new Float32Array( this.numShapes ) );
    let intensity = this.intensity;
    for ( let i = 0; i < this.numShapes; i++ ) {
        result[ i ] = lower[ i ] * ( 1 - intensity ) + upper[ i ] * intensity;
    }
    return result;
}

/**
* 
* @param {*} phoneme 
* @returns returns a reference to the coart entry
*/
Text2Lip.prototype.getCoarts = function ( phoneme ) {
    // this handles properly undefined and nulls.
    if ( !( phoneme in this.ph2v ) ) { return this.coarts[ 0 ]; } // assuming there are coarts
    let visIdx = this.ph2v[ phoneme ];
    if ( visIdx < 0 || visIdx >= this.coarts.length ) { return this.coarts[ 0 ]; } // assuming there are visemes
    return this.coarts[ visIdx ];
}

/**
* 
* @param {*} phoneme 
* @param {*} phonemeAfter 
* @param {*} outResult  if not null, result will be written to this array. Otherwise a new array is generated with the resulting values and returned 
* @returns returns outResult or a new Float32Array
*/
Text2Lip.prototype.getCoarticulatedViseme = function ( phoneme, phonemeAfter, outResult = null ) {
    let rawTarget = this.getViseme( phoneme );
    let coartsW = this.getCoarts( phoneme ); // coarticulation weights of target phoneme

    //let visemePrev = this.currV; // phoneme before target
    let visemeAfter = this.getViseme( phonemeAfter ); // phoneme after target

    let result = ( outResult ) ? outResult : ( new Float32Array( this.numShapes ) );

    for ( let i = 0; i < this.numShapes; ++i ) {
        result[ i ] = ( 1.0 - coartsW[ i ] ) * rawTarget[ i ] + coartsW[ i ] * visemeAfter[ i ]//(0.2 * visemePrev[i] + 0.8 * visemeAfter[i]);
    }

    return result;
}

// constant
Text2Lip.QUEUE_MAX_SIZE = 32;

Text2Lip.prototype.start = function () {
    this.stop( false );
    this.working = true;
    this.paused = false;

    this.changeCurrentSentence( false );
}

Text2Lip.prototype.pause = function () { this.paused = this.working; } // can only be paused if working
Text2Lip.prototype.resume = function () { this.paused = false; }

/**
* stops update. No sentence is modified. However some variables are reseted, meaning the sentence being displayed currently will start from the beginning 
* if a start is called
* To completely clean the queue, call cleanQueueSentences or pass true as argument
* @param {Bool} cleanQueue if true, all pending sentences are cleared and will not be displayed. 
*/
Text2Lip.prototype.stop = function ( cleanQueue = false ) {
    this.working = false;
    this.paused = false;
    this.currTargetIdx = 0; // for a smooth intro
    this.currT = 0;

    this.BSW.fill( 0 );
    this.currV.fill( 0 );
    this.targV.fill( 0 );

    if ( !!cleanQueue ) // force to be boolean
        this.cleanQueueSentences();
}

/**
* returns a number 
* Bit 0: set when module is not working ( stopped )
* Bit 1: set when module is working but paused
* Bit 2: set when module does not have more sentences to compute. If working, it is idle, waiting for some push
* if the entire value is 0, the module is actively working
* @returns 
*/
Text2Lip.prototype.getCompactState = function () {
    let result = !this.working;
    result |= this.paused << 1;
    result |= ( !this.queueSize ) << 2;
    return result;
}

Text2Lip.prototype.isWorking = function () { return this.working; }
Text2Lip.prototype.isPaused = function () { return this.paused; }
Text2Lip.prototype.needsSentences = function () { return !this.queueSize; }
Text2Lip.prototype.getNumSentences = function () { return this.queueSize; }
Text2Lip.prototype.getMaxNumSentences = function () { return Text2Lip.QUEUE_MAX_SIZE; }

Text2Lip.prototype.update = function ( dt ) {
    if ( !this.working || this.paused || !this.currSent ) { return; }

    // check for sentence delay
    if ( this.delay > 0.001 ) {
        this.delay -= dt;

        if ( this.delay >= 0.0 ) {
            return;
        }
        dt = -this.delay;
        this.delay = 0;
        if ( dt < 0.001 ) return;
    }
    let durations = this.currSent.phT;

    let invSpeed = 1.0 / this.speed; // seconds / phoneme
    this.currT += dt;

    let p = 0;
    let t = 0;
    let useGeneralSpeed = true; // when durations array ends, it should continue with general speed
    // use specific phoneme durations
    if ( durations && this.currTargetIdx < durations.length ) {
        useGeneralSpeed = false;
        let durationIdx = this.currTargetIdx;
        while ( durationIdx < durations.length && durations[ durationIdx ] < this.currT ) {
            this.currT -= Math.max( 0.001, durations[ durationIdx ] );
            durationIdx++;
            p++;
        }
        useGeneralSpeed = durationIdx >= durations.length; // durations array has ended. Check general speed
        this.currT = Math.max( 0, this.currT ); // just in case
        t = ( durationIdx < durations.length ) ? ( this.currT / durations[ durationIdx ] ) : Math.max( 0.0, Math.min( 1.0, this.currT * this.speed ) ); // after phoneme ease-in, t will be clamped to 1 until phoneme change
        this.currTargetIdx = durationIdx;
    }

    // no more specific phoneme durations and there is enough time to check 
    if ( useGeneralSpeed ) {
        // use temporal p variable to avoid overwriting durations array result
        let general_p = Math.floor( this.currT * this.speed ); // complete phonemes 
        t = ( this.currT * this.speed ) - general_p;  // remaining piece of phoneme, used on interpolation
        this.currT -= general_p * invSpeed;
        this.currTargetIdx += general_p;
        p += general_p;
    }


    // t function modifier;
    //t = 0.5* Math.sin( t * Math.PI - Math.PI * 0.5 ) +0.5; // weird on slow phonemes

    // phoneme changed
    if ( p > 0 ) {

        // copy target values to source Viseme. Several phonemes may have passed during this frame. Take the last real target phoneme
        // let lastPhonemeIndex = Math.max( 0.0, Math.min( this.text.length - 1, this.currTargetIdx - 1 ) ); // currTargetIdx here is always > 0. text.length here is always > 0
        // this.intensity = this.getIntensityAtIndex( lastPhonemeIndex ); // get last real target viseme with correct intensity, in case more than 1 phoneme change in the same frame

        // let lastPhoneme = this.text[ lastPhonemeIndex ];
            
        // if ( this.useCoarticulation ){
        //     let lastPhonemeNext = ( lastPhonemeIndex == ( this.text.length - 1 ) ) ? null : ( this.text[ lastPhonemeIndex + 1 ] );
        //     this.getCoarticulatedViseme( lastPhoneme, lastPhonemeNext, this.currV );
        // }
        // else{
        //     this.getViseme( lastPhoneme, this.currV );
        // }
        for ( let i = 0; i < this.numShapes; ++i ) {
            this.currV[ i ] = this.BSW[ i ];
        }

        // end of sentence reached
        if ( this.currTargetIdx >= this.text.length ) {
            this.getViseme( this.text[ this.text.length-1 ], this.currV );
            for ( let i = 0; i < this.numShapes; ++i ) { this.BSW[ i ] = this.currV[ i ]; } // currV holds the last real target phoneme
            this.changeCurrentSentence();
            return;
        }

        this.intensity = this.getIntensityAtIndex( this.currTargetIdx ); // get intensity for next target

        if ( !this.useCoarticulation ) {
            this.getViseme( this.text[ this.currTargetIdx ], this.targV );
        }
        else {
            let targetPhoneme = this.text[ this.currTargetIdx ];
            let targetPhonemeNext = ( this.currTargetIdx == ( this.text.length - 1 ) ) ? null : this.text[ this.currTargetIdx + 1 ];
            this.getCoarticulatedViseme( targetPhoneme, targetPhonemeNext, this.targV );
        }
    }

    // final interpolation
    let BSW_0 = this.currV;
    let BSW_1 = this.targV;

    for ( let i = 0; i < this.numShapes; ++i ) {
        this.BSW[ i ] = ( 1.0 - t ) * BSW_0[ i ] + t * BSW_1[ i ];
    }
}

Text2Lip.prototype.cleanQueueSentences = function ( clearVisemes = false ) {
    this.queueIdx = 0;
    this.currSent = null;
    this.queueSize = 0;
    this.sentenceQueue.fill( null );
    
    if ( clearVisemes ){
        this.BSW.fill( 0 );
        this.currV.fill( 0 );
        this.targV.fill( 0 );
    }
}

/**
* sets all necessary parameters for the sentence indicated by queueIdx (if any).  
* @param {Bool} advanceIndex before setting paramters, index of sentence is incremented and amoun of sentences reduced, discarding the previous sentence
* @returns 
*/
Text2Lip.prototype.changeCurrentSentence = function ( advanceIndex = true ) {

    if ( advanceIndex ) { // when executing start(), do not advance 
        --this.queueSize;
        this.sentenceQueue[ this.queueIdx ] = null; // dereference obj
        this.queueIdx = ( this.queueIdx + 1 ) % Text2Lip.QUEUE_MAX_SIZE;

        // end events
        if ( this.currSent && this.onSentenceEnd ) { this.onSentenceEnd( this.currSent ); }
        if ( this.currSent.onEndEvent ) { this.currSent.onEndEvent(); }
    }

    if ( this.queueSize <= 0 ) {
        this.currT = 0;
        this.cleanQueueSentences();
        if ( this.onIdle ) { this.onIdle(); }
        return;
    }

    // parameters setup
    this.currSent = this.sentenceQueue[ this.queueIdx ];

    this.text = this.currSent.text;
    this.speed = this.currSent.speed;
    this.delay = this.currSent.delay;
    this.useCoarticulation = this.currSent.useCoart;

    this.currTargetIdx = 0;
    if ( !advanceIndex ) { this.currT = 0; } // reset timer only if called from start. Otherwise keep remaining time from previous sentence

    // target first phoneme
    this.intensity = this.getIntensityAtIndex( this.currTargetIdx ); // get target viseme with correct intensity

    if ( this.useCoarticulation ) {
        let targetPhoneme = this.text[ 0 ];
        let targetPhonemeNext = ( this.text.length > 1 ) ? this.text[ 1 ] : null;
        this.getCoarticulatedViseme( targetPhoneme, targetPhonemeNext, this.targV );
    }
    else {
        this.getViseme( this.text[ 0 ], this.targV );
    }

    // Start events
    if ( this.onSentenceStart ) { this.onSentenceStart( this.currSent ); } // generic start event
    if ( this.currSent.onStartEvent ) { this.currSent.onStartEvent(); }     // sentence specifici start event
}

/**
* Adds sentence to the queue.
WARNING!!!
Each sentence will have a smooth intro and outro. (from neutral to phoneme and from phoneme to neutral pose)
   - Intro time DOES NOT have to be accounted for on any timing
   - Outro time HAVE to be accounted for timings. If not included in sentT, the system will use default phoneme speed to transition to neutral. sentT should take it into account
Any value below 0.001 will be ignored.
* @param {string/array} text string of phonemes to display 
* @param {object} options object containing any of the optional string of phonemes to display.
* @param {Float32Array} phT (Optional) timing for each phoneme. Overrides sentT, speed and default speed.
* @param {Number} sentT (Optional): Number, timing (in seconds) of whole string. Overrides default speed and speed argument. Delay not included. Defaults to null.
* @param {Number} speed (Optional) phonemes/s of whole string. Overrides default speed. Delay not included.
* @param {Float32Array} phInt (Optional) intensity for each phoneme. Overrides sentInt and default intensity.
* @param {Number} sentInt (Optional) intensity of whole string. Overrides default intensity. Delay not included.
* @param {Boolean} useCoart (Optional) use coarticulation. Default to true.
* @param {Number} delay (Optional) delay to start playing this string. Delay starts at the end of the sentence it is being played now. If none, delay starts immediately.
* @param {Boolean} copyArrays (Optional) Whether to create new arrays and copy values or directly use the reference sent as argument. Defaults to false (only reference is used).
* @param {Boolean} outro (Optional) Whether to automatically include a final "." into the string to end in neutral pose. Defaults to false.
* @param {Function} onStartEvent (Optional) when sentence starts, this event is called after the generic onSentenceStart event.
* @param {Function} onEndEvent (Optional) when sentence ends, this event is called after the generic onSentenceEnd event.
* @returns the id number of the sentence if successful. 0 otherwise.
*/
Text2Lip.prototype.pushSentence = function ( text, options = {} ) {
    let phT = options.phT;
    let sentT = options.sentT;
    let speed = options.speed;
    let phInt = options.phInt;
    let sentInt = options.sentInt;
    let delay = options.delay;
    let outro = options.outro;
    let useCoart = options.useCoart;
    let copyArrays = options.copyArrays;
    let onEndEvent = options.onEndEvent;
    let onStartEvent = options.onStartEvent;

    if ( this.queueSize === Text2Lip.QUEUE_MAX_SIZE ) { return null; }
    if ( !text || !text.length ) { return null; }

    // clean input
    phT = phT ? new Float32Array( phT ) : null;
    phInt = phInt ? new Float32Array( phInt ) : null;

    if ( copyArrays ) {
        text = Array.from( text ); // create new array from
        if ( phT ) {
            let temp = new Float32Array( phT.length );
            temp.set( phT );
            phT = temp;
        }
        if ( phInt ) {
            let temp = new Float32Array( phInt.length );
            temp.set( phInt );
            phInt = temp;
        }
    }

    // put outro 
    if ( !!outro ) {
        if ( typeof ( text ) === 'string' ) { text = text + "."; }
        else { text.push( "." ); }
    }
    if ( text.length < 0 ) { return null; }


    let sentenceSpeed = this.DEFAULT_SPEED;
    if ( typeof ( speed ) === 'number' && !isNaN( speed ) && speed >= 0.001 ) { sentenceSpeed = speed; }
    if ( typeof ( sentT ) === 'number' && !isNaN( sentT ) && sentT >= 0.001 ) { sentenceSpeed = text.length / sentT; }
    if ( typeof ( delay ) !== 'number' || isNaN( delay ) || delay < 0 ) { delay = 0; }
    if ( typeof ( useCoart ) === 'undefined' ) { useCoart = true; } useCoart = !!useCoart;
    if ( !( onEndEvent instanceof Function ) ) { onEndEvent = null; }
    if ( !( onStartEvent instanceof Function ) ) { onStartEvent = null; }


    if ( typeof ( sentInt ) !== 'number' || isNaN( sentInt ) ) { sentInt = null; } // this allows for changing intensity while mouthing through setDefaulIntensity
    else { sentInt = Math.max( 0.0, Math.min( 1.0, sentInt ) ); }


    let id = this.sentenceIDCount++;
    let totalTime = this.getSentenceDuration( text, options ); // doing work twice, though...
    let sentenceObj = {
        id: id,
        totalTime: totalTime,
        text: text,
        phT: phT,
        speed: sentenceSpeed,
        phInt: phInt,
        sentInt: sentInt,
        useCoart: useCoart,
        delay: delay,
        onStartEvent: onStartEvent,
        onEndEvent: onEndEvent,
    }

    let indexPos = ( this.queueIdx + this.queueSize ) % Text2Lip.QUEUE_MAX_SIZE;
    this.sentenceQueue[ indexPos ] = sentenceObj; // only reference is copied
    this.queueSize++;

    // when working but idle because of no sentences, automatically play this new sentence
    if ( this.working && this.queueSize == 1 ) {
        this.changeCurrentSentence( false );
    }
    return { id: id, totalTime: totalTime };
};

/**
* Send the same info you would send to pushSentence.
* @param {string/array} text 
* @param {object} options 
* @returns in seconds
*/
Text2Lip.prototype.getSentenceDuration = function ( text, options ) {
    // THE ONLY REASON THIS IS NOT STAIC IS BECAUSE IT USES this.DEFAULT_SPEED   
    let phT = options.phT;
    let sentT = options.sentT;
    let speed = options.speed;
    let delay = options.delay;
    let outro = options.outro;

    if ( !text || !text.length ) { return 0; }
    if ( !( phT instanceof Float32Array ) ) phT = null;

    let textLength = text.length;
    if ( !!outro ) { textLength++; }
    let sentenceSpeed = this.DEFAULT_SPEED;
    if ( typeof ( speed ) === 'number' && !isNaN( speed ) && speed >= 0.001 ) sentenceSpeed = speed;
    if ( typeof ( sentT ) === 'number' && !isNaN( sentT ) && sentT >= 0.001 ) sentenceSpeed = textLength / sentT;

    if ( typeof ( delay ) !== 'number' || isNaN( delay ) || delay < 0 ) delay = 0;


    let totalTime = 0;
    totalTime += delay;

    if ( phT ) {
        let validEntries = ( phT.length >= textLength ) ? textLength : phT.length;
        for ( let i = 0; i < validEntries; ++i ) { totalTime += Math.max( phT[ i ], 0.001 ); }

        textLength -= validEntries;
    }

    // use sentence speed to compute time of phonemes with no phT
    totalTime += textLength * ( 1.0 / sentenceSpeed );

    return totalTime;
}

// TABLES ------------------------------

//[ "kiss", "upperLipClosed", "lowerLipClosed", "jawOpen", "tongueFrontUp", "tongueBackUp", "tongueOut" ],
let t2lLowerBound = [
  [ 0,     0,     0,     0,     0,     0,     0   ], // 0
  [ 0,     0,     0,     0,     0,     0,     0   ],
  [ 0.1,   0.15,  0,     0.2,   0,     0,     0   ],
  [ 0.0,   0.13,  0,     0.2,   0.2,   0,     0   ],
  [ 0,     0.08,  0,     0.1,   0.5,   0.5,   0   ], // 4
  [ 0.25,  0.15,  0.15,  0.2,   0,     0,     0   ],
  [ 0.35,  0.15,  0.15,  0.2,   0,     0,     0   ],
  [ 0.0,   0.15,  0,     0.1,   1,     0,     0   ],
  [ 0,     0.5,   0.2,   0.0,   0,     0,     0   ], // 8
  [ 0,     0.0,   0.2,   0.1,   0,     0,     0   ],
  [ 0.15,  0,     0,     0.13,  0.8,   0,     0   ],
  [ 0.0,   0,     0,     0.2,   0.0,   0.3,   0   ],
  [ 0.0,   0,     0,     0.1,   0.0,   1,     0   ], // 12
  [ 0.3,   0,     0,     0.1,   1,     0,     0   ],
  [ 0,     0,     0.0,   0.1,   0.35,  0,     0.3 ],
  [ 0.3,   0,     0,     0.13,   0.8,   0,     0  ],
];

let t2lUpperBound = [
  [ 0,     0,     0,     0,     0,     0,     0   ], // 0
  [ 0,     0,     0,     0,     0,     0,     0   ], 
  [ 0.1,   0.15,  0,     0.6,   0,     0,     0   ],
  [ 0.0,   0.13,  0,     0.3,   0.2,   0,     0   ],
  [ 0,     0.08,  0,     0.2,   0.6,   0.6,   0.2 ], // 4
  [ 0.45,  0.15,  0.15,  0.6,   0,     0,     0   ],
  [ 0.85,  0.3,   0.3,   0.3,   0,     0,     0   ],
  [ 0.0,   0.15,  0,     0.4,   1,     0,     0.5 ],
  [ 0,     1,     1,     0.0,   0,     0,     0   ], // 8
  [ 0,     0.0,   1,     0.4,   0,     0,     0   ],
  [ 0.15,  0,     0,     0.13,  0.8,   0,     0   ],
  [ 0.0,   0,     0,     0.4,   0.0,   0.3,   0   ],
  [ 0.1,   0,     0,     0.2,   0.0,   1,     0   ], // 12
  [ 0.3,   0,     0,     0.22,  1,     0,     0   ],
  [ 0,     0,     0.0,   0.4,   0.55,  0,     0.8 ],
  [ 0.3,   0,     0,     0.13,  0.8,   0,     0   ],
];

// coarticulation weights for each phoneme. 0= no modification to phoneme, 1=use phonemes arround to build viseme
let t2lCoarts = [
  [ 0,     0,     0,     0,     0,     0,     0   ], // 0
  [ 0.6,   0.6,   0.6,   0.6,   0.6,   0.6,   0.6 ],
  [ 0.2,   0.3,   0.3,   0.3,   0.1,   0.3,   0.5 ],
  [ 0.0,   0.3,   0.3,   0.3,   0.1,   0.3,   0.5 ],
  [ 0.1,   0.3,   0.3,   0.3,   0,     0,     0.5 ], // 4
  [ 0.2,   0.3,   0.3,   0.3,   0.3,   0.3,   0.5 ],
  [ 0.2,   0.3,   0.3,   0.3,   0.3,   0.3,   0.5 ],
  [ 1,     0.4,   0.4,   0.9,   0,     0.5,   0.5 ],
  [ 1,     0,     0,     0.0,   1,     0.8,   0.5 ], //8 
  [ 1,     0,     0,     0.2,   1,     0.5,   0.5 ],
  [ 1,     0.6,   0.6,   0.6,   0,     0.5,   0.5 ],
  [ 1,     1,     1,     0.7,   0.5,   0.5,   0.5 ],
  [ 0.7,   0.5,   0.5,   0.9,   0.6,   0,     0.5 ], //12
  [ 1,     1,     1,     0.5,   0,     0,     0.5 ],
  [ 1,     0.3,   0.3,   0.3,   0,     0.6,   0   ], 
  [ 0.5,   0.3,   0.3,   0.5,  0,     0,     0    ],

];

let t2lPh2v = {
    ".": 0, "_": 1, " ": 1,
    "a": 2,//"AA"	 
    "@": 2,//"AE"	 
    "A": 2,//"AH"	 
    "c": 5,//"AO"	 
    "W": 2,//"AW"	 
    "x": 2,//"AX"	 
    "Y": 2,//"AY"	 
    "E": 3,//"EH"	 
    "R": 3,//"ER"	 
    "e": 3,//"EY"	 
    "I": 4,//"IH"	 
    "X": 4,//"IX"	 
    "i": 4,//"IY"	 
    "o": 5,//"OW"	 
    "O": 5,//"OY"	 
    "U": 6,//"UH"	 
    "u": 6,//"UW"	 

    "b": 8,//"B"	
    "C": 15,//"CH"	 // ------------------------ Really needs a new viseme - 'SH'
    "d": 13,//"D"	
    "D": 13,//"DH"	
    "F": 13,//"DX"	
    "L": 7,//"EL"	
    "M": 8,//"EM"	
    "N": 7,//"EN"	
    "f": 9,//"F"	
    "g": 12,//"G"	
    "h": 11,//"H"	// reduced
    "J": 15,//"JH"	 // ------------------------- Really needs a new viseme 'ZH'
    "k": 12,//"K"	
    "l": 7,//"L"	
    "m": 8,//"M"	
    "n": 7,//"N"	
    "G": 12,//"NG"	// reduced
    "p": 8,//"P"	
    "Q": 2,//"Q"	 // -------------------------- What is this?
    "r": 7,//"R"	
    "s": 10,//"S"	
    "S": 15,//"SH"	 // ------------------------ Really needs a new viseme - 'CH'
    "t": 13,//"T"	
    "T": 14,//"TH"	
    "v": 9,//"V"	
    "w": 6,//"W"	
    "H": 6,//"WH"	
    "y": 4,//"Y"	
    "z": 10,//"Z"	
    "Z": 10,//"ZH"	 // ------------------------- Really needs a new viseme 'JH'
};

let T2LTABLES = {
    BlendshapeMapping: { kiss: 0, upperLipClosed: 1, lowerLipClosed: 2, jawOpen: 3, tongueFrontUp: 4, tongueBackUp: 5, tongueOut: 6 },
    LowerBound: t2lLowerBound,
    UpperBound: t2lUpperBound,
    Coarticulations: t2lCoarts,
    PhonemeToViseme : t2lPh2v,
}

/* ANIMATION */
AnimationManager.prototype.animations = {
    "IDLE": "evalls/projects/animations/animations_idle.wbin",
    "WAVE": "evalls/projects/animations/animations_waving.wbin",
    "NO": "evalls/projects/animations/animations_no.wbin",
    "BORED": "evalls/projects/animations/animations_bored.wbin",
    "ANGRY": "evalls/projects/animations/animations_angry.wbin",
    "HAPPY": "evalls/projects/animations/animations_happy.wbin",
    "PRAYING": "evalls/projects/animations/animations_praying.wbin",
    "CRAZY": "evalls/projects/animations/animations_crazy.wbin"
}

function AnimationManager(component, animations) {

    this.animManager = component;

    // Animations
    this.animations = animations || this.animations;
    this.playing = false;
}

// animationData with animationID, sync attr, speed
AnimationManager.prototype.newAnimation = function (animationData, animations) {
    
    this.currentAnim = {
        speed: this.animManager.playback_speed,
        animation: this.animManager.animation
    }

    this.playing = false;
    // Sync
    this.start = animationData.start || 0.0;
    this.speed = animationData.speed || 1.0;
    this.shift = animationData.shift;
    this.time = 0;
    var url = this.animations[animationData.name];
    this.animationName = url;
    var anim = LS.RM.getResource(this.animationName)

    if (!anim)
        LS.RM.load(this.animationName, null, this.setDuration.bind(this))
    else
        this.setDuration(anim)
}

AnimationManager.prototype.initValues = function () {
    
    this.time = 0;
}

AnimationManager.prototype.setDuration = function (anim) {
    
    this.duration = anim.takes.default.duration;
}

AnimationManager.prototype.update = function (dt) {

    if (this.time == 0)
        this.initValues();
    // Wait for to reach start time

    if (this.time < this.start) {
        return;
    }
    else if (this.time >= this.start && !this.playing) {
        this.animManager.playback_speed = this.speed;
        this.animManager.animation = this.animationName;
        this.playing = true;
    }
    else if (!this.shift && this.time >= this.duration && this.playing) {
        this.animManager.animation = this.currentAnim.animation;
        this.animManager.playback_speed = this.currentAnim.speed;
    }

    this.time += dt;
}



class HandInfo {
    constructor(){
        this.shape = [ 
            [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()], // thumb base, mid, pad
            [0,0,0,0], // index splay, base, mid, pad
            [0,0,0,0], // middle
            [0,0,0,0], // ring
            [0,0,0,0]  // pinky
        ];
    }

    reset(){
        this.shape[0][0].set(0,0,0,1);
        this.shape[0][1].set(0,0,0,1);
        this.shape[0][2].set(0,0,0,1);
        for( let i = 1; i < 5; ++i ){
            for( let j = 0; j < 3; ++j ){
                this.shape[i][j] = 0;
            }
        }
    }

    copy( srcHandInfo ){
        // thumb
        let src = srcHandInfo.shape[0];
        let dst = this.shape[0];
        dst[0].copy( src[0] );
        dst[1].copy( src[1] );
        dst[2].copy( src[2] );

        // fingers
        for( let i = 1; i < 5; ++i ){
            src = srcHandInfo.shape[i];
            dst = this.shape[i];
            dst[0] = src[0];
            dst[1] = src[1];
            dst[2] = src[2];
            dst[3] = src[3];
        }
    }

    lerpHandInfos( srcHandInfo, trgHandInfo, t ){
        // src and trg could be this without problems
        let fsrc = srcHandInfo.shape[0];
        let ftrg = trgHandInfo.shape[0];
        let fdst = this.shape[0];

        // thumb quats
        nlerpQuats( fdst[0], fsrc[0], ftrg[0], t );
        nlerpQuats( fdst[1], fsrc[1], ftrg[1], t );
        nlerpQuats( fdst[2], fsrc[2], ftrg[2], t );
        
        // finger splay + bends
        for( let i = 1; i < 5; ++i ){
            fsrc = srcHandInfo.shape[i];
            ftrg = trgHandInfo.shape[i];
            fdst = this.shape[i];
            fdst[0] = fsrc[0] * (1.0-t) + ftrg[0] * t;
            fdst[1] = fsrc[1] * (1.0-t) + ftrg[1] * t;
            fdst[2] = fsrc[2] * (1.0-t) + ftrg[2] * t;
            fdst[3] = fsrc[3] * (1.0-t) + ftrg[3] * t;
        }
    }

    lerp( trgHandInfo, t ){ this.lerpHandInfos( this, trgHandInfo, t ); }

    setDigit( digit, info ){
        let dst = this.shape[digit];

        if ( digit == 0 ){
            dst[0].copy( info[0] );
            dst[1].copy( info[1] );
            dst[2].copy( info[2] );
        }
        else {
            dst[0] = info[0];
            dst[1] = info[1];
            dst[2] = info[2];
            dst[3] = info[3];
        }
    }

    setDigits( thumbInfo = null, indexInfo = null, middleInfo = null, ringInfo = null, pinkyInfo = null ){
        if ( thumbInfo ){ this.thumb = thumbInfo; } 
        if ( indexInfo ){ this.index = indexInfo; } 
        if ( middleInfo ){ this.middle = middleInfo; } 
        if ( ringInfo ){ this.ring = ringInfo; } 
        if ( pinkyInfo ){ this.pinky = pinkyInfo; } 
    }
    set thumb( digitInfo ){ this.setDigit( 0, digitInfo ); }
    set index( digitInfo ){ this.setDigit( 1, digitInfo ); }
    set middle( digitInfo ){ this.setDigit( 2, digitInfo ); }
    set ring( digitInfo ){ this.setDigit( 3, digitInfo ); }
    set pinky( digitInfo ){ this.setDigit( 4, digitInfo ); }

    getDigit( digit ){ return this.shape[digit]; }
    get thumb(){ return this.shape[0]; }
    get index(){ return this.shape[1]; }
    get middle(){ return this.shape[2]; }
    get ring(){ return this.shape[3]; }
    get pinky(){ return this.shape[4]; }
}

class HandShape {
    constructor( config, skeleton, isLeftHand = false ){
        this._tempQ_0 = new THREE.Quaternion(0,0,0,1);

        this.skeleton = skeleton;
        this.isLeftHand = !!isLeftHand;
        this.config = config;
        let boneMap = config.boneMap;
        this.handLocations = this.isLeftHand ? config.handLocationsL : config.handLocationsR;
        let handName = this.isLeftHand ? "L" : "R";
        this.wristIdx = boneMap[ handName + "Wrist" ];
        this.fingerIdxs = [ // base bone indexes. The used bones will be i (base finger), i+1 (mid finger) and i+2 (tip finger). 
            boneMap[ handName + "HandThumb" ], 
            boneMap[ handName + "HandIndex" ],
            boneMap[ handName + "HandMiddle" ], 
            boneMap[ handName + "HandRing" ], 
            boneMap[ handName + "HandPinky" ] 
        ];
        
        this.thumbIKMaxIter = 30;

        this.fingerAxes = this._computeFingerAxesOfHand( ); // axes in after-bind space
        this._computeLookUpTables();
        
        this.curG = new HandInfo();
        this.srcG = new HandInfo();
        this.trgG = new HandInfo();
        this.defG = new HandInfo();

        this.time = 0; // current time of transition
        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0; 
        this.end = 0;

        this.transition = false;
        
        this.reset();
    }

    reset() {
        this.transition = false;
        this.time = 1; this.start = 0; this.attackPeak = 0; this.relax = 0; this.end = 0.1;
        
        let bones = this.skeleton.bones;
        let q = null;
        for ( let i = 0; i < 5; ++i ){
            for ( let j = 0; j < 3; ++j ){
                q = this.fingerAxes.bindQuats[ i*3 + j ];
                bones[ this.fingerIdxs[i] + j ].quaternion.copy( q );
            }
        }

        this.curG.reset();
        this.curG.thumb = this.fingerAxes.bindQuats; // class setter
        this.defG.reset();
        this.defG.thumb = this.fingerAxes.bindQuats; // class setter
        
        this.transition = true
        this.update( 1 ); // force position reset
    }

    // must always update bones. (this.transition would be useless)
    update( dt, fingerplayResult = null ) {       
        if ( !this.transition && !fingerplayResult ){ return; }

        this.time +=dt;
        let bones = this.skeleton.bones;
        let fingerIdxs = this.fingerIdxs;
        
        if ( this.time < this.start ){}
        else if ( this.time < this.attackPeak ){
            let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
            this.curG.lerpHandInfos( this.srcG, this.trgG, t );
        }
        else if ( this.time < this.relax ){
            this.curG.copy( this.trgG );
        }
        else if ( this.time < this.end ){
            let t = ( this.time - this.relax ) / ( this.end - this.relax );
            this.curG.lerpHandInfos( this.trgG, this.defG, t );
        }
        else{
            this.curG.copy( this.defG );
            this.transition = false;
        }

        if ( fingerplayResult ){
            this.curG.index[1] = Math.max( -0.2, Math.min( 1, this.curG.index[1] + fingerplayResult[1] ) );
            this.curG.middle[1] = Math.max( -0.2, Math.min( 1, this.curG.middle[1] + fingerplayResult[2] ) );
            this.curG.ring[1] = Math.max( -0.2, Math.min( 1, this.curG.ring[1] + fingerplayResult[3] ) );
            this.curG.pinky[1] = Math.max( -0.2, Math.min( 1, this.curG.pinky[1] + fingerplayResult[4] ) );
        }

        this._setFingers( this.curG.index, this.curG.middle, this.curG.ring, this.curG.pinky );
        this._setThumb( this.curG.thumb );

        if ( fingerplayResult ){
            bones[ fingerIdxs[0] ].quaternion.multiply( this._tempQ_0.setFromAxisAngle( this.fingerAxes.bendAxes[0], fingerplayResult[0] * Math.PI * 40 / 180 ) );
        }
    }

    thumbIK( targetWorldPos, shortChain = false, splay = null ){
        let tempQ_0 = new THREE.Quaternion();
        let tempQ_1 = new THREE.Quaternion();
        let tempV3_0 = new THREE.Vector3();
        let tempV3_1 = new THREE.Vector3();
    
        let thumbBase = this.fingerIdxs[0]
        let bones = this.skeleton.bones;
        let bindQuats = this.fingerAxes.bindQuats;
        let bendAxes = this.fingerAxes.bendAxes;
        bones[ thumbBase ].quaternion.copy( bindQuats[ 0 ] );
        bones[ thumbBase + 1 ].quaternion.copy( bindQuats[ 1 ] );
        bones[ thumbBase + 2 ].quaternion.copy( bindQuats[ 2 ] );
        bones[ thumbBase + 3 ].updateWorldMatrix( true, false );
        
        let chain = null;
        let endEffector = null;
        
        if ( shortChain ){
            chain = [ bones[ thumbBase ], bones[ thumbBase + 1 ], bones[ thumbBase + 2 ] ]; 
            endEffector = bones[ thumbBase + 2 ];
        }
        else {
            chain = [ bones[ thumbBase ], bones[ thumbBase + 1 ], bones[ thumbBase + 2 ], bones[ thumbBase + 3 ] ]; 
            endEffector = this.handLocations["1_TIP"];
        }
    
        // CCD
        let maxIter = this.thumbIKMaxIter;
        for ( let iter = 0; iter < maxIter; ++iter ){
            let lastBone = (iter > 0) ? 0 : 1; // first iteration ignore base joint
            
            for ( let i = chain.length - 2 ; i >= lastBone; --i ){
                let endEffectorWorldPos = endEffector.getWorldPosition( tempV3_0 );
                if ( tempV3_1.subVectors( endEffectorWorldPos, targetWorldPos ).lengthSq() < 0.001*0.001 ){ iter = maxIter; break; }
    
                let joint = chain[i];
                
                let endEffectorLocalPos = joint.worldToLocal( tempV3_0.copy( endEffectorWorldPos ) ).normalize().applyQuaternion( joint.quaternion );
                let targetLocalPos = joint.worldToLocal( tempV3_1.copy( targetWorldPos ) ).normalize().applyQuaternion( joint.quaternion );
    
                tempQ_0.setFromUnitVectors( endEffectorLocalPos, targetLocalPos );
    
                if( i != 0 ){ 
                    // apply hinge constraint to upper bones, except base joint
                    let bendAxis = bendAxes[ i ]; // after bind space
                    tempQ_1.setFromUnitVectors( tempV3_0.copy( bendAxis ).applyQuaternion( tempQ_0 ), bendAxis );
                    tempQ_0.premultiply( tempQ_1 );
    
                    joint.quaternion.premultiply( tempQ_0 );
                
                    // if bone is bent to forbidden (negative == 180º+ angles) angles, restore bind. Except base joint
                    tempQ_1.copy( bindQuats[ i ] ).invert();
                    tempQ_1.premultiply( joint.quaternion );
                    let dot = tempQ_1.x * bendAxis.x + tempQ_1.y * bendAxis.y +tempQ_1.z * bendAxis.z; // kind of a twist decomposition
                    if ( dot < 0 ){ tempQ_1.w *= -1;}
                    if ( tempQ_1.w < 0 ) { joint.quaternion.copy( bindQuats[ i ] ); }
                }else{
                    joint.quaternion.premultiply( tempQ_0 );
                }
    
                joint.updateWorldMatrix();
            } 
        }
    
        // compute automatic splay
        if ( isNaN( splay ) || splay === null ){
            let m3 = ( new THREE.Matrix3() ).setFromMatrix4( bones[ this.wristIdx ].matrixWorld );
            let palmLateralVec = this.thumbThings.palmLateralVec.clone().applyMatrix3( m3 ).normalize();
            let palmOutVec = this.thumbThings.palmOutVec.clone().applyMatrix3( m3 ).normalize();
            let palmUpVec = this.thumbThings.palmUpVec.clone().applyMatrix3( m3 ).normalize();
            let thumbSizeFull = this.thumbThings.thumbSizeFull;
            let thumbSizeUpper = this.thumbThings.thumbSizeUpper;
            endEffector.getWorldPosition( tempV3_0 );
            this.handLocations[ "HAND_RADIAL" ].getWorldPosition( tempV3_1 );
            tempV3_0.sub( tempV3_1 );
            
            tempV3_1.set( palmLateralVec.dot( tempV3_0 ), palmUpVec.dot( tempV3_0 ), palmOutVec.dot( tempV3_0 ) ); // base change
            tempV3_1.x *= -1; // palmLateralVec vector is pointing outwards
    
            let lateralSplayRaw = Math.min( 1, Math.max( 0, tempV3_1.x / thumbSizeUpper ) );
            let lateralSplay = 0.25 * Math.min( 1, Math.max( 0, ( tempV3_1.x - thumbSizeUpper*0.5 ) / thumbSizeUpper ) ); // not so important
            let outSplay = Math.min( 1, Math.max( 0, tempV3_1.z / thumbSizeUpper ) );
            outSplay = outSplay * 0.65 + outSplay * 0.45 * lateralSplayRaw;
            splay = Math.max(0, Math.min( 1, lateralSplay + outSplay ) );
        }
        
        // splay must be applied after bind and bending is applied
        splay = this.angleRanges[0][0][0] * (1-splay) + this.angleRanges[0][0][1] * splay; // user specified angle range
        splay *= ( this.isLeftHand ? 1 : -1 );
        endEffector.getWorldPosition( tempV3_0 );
        bones[ thumbBase ].worldToLocal( tempV3_0 ).applyQuaternion( bones[ thumbBase ].quaternion );
        tempQ_0.setFromAxisAngle( tempV3_0.normalize(), splay );
        bones[ thumbBase ].quaternion.premultiply( tempQ_0 );
    }

    /**
     * Assumes character is in tpose and bind pose
     * @returns object with bendAxes, splayAxes and bindQuats. BindQuats might differ from real skeleton bind quaternions. Axes are after-bindQuats space (i.e quat(axis, angle) must be premultiplied to bindQuat)
     */
    _computeFingerAxesOfHand( ){

        let isLeftHand = this.isLeftHand;
        let bones = this.skeleton.bones;
        let fingers = this.fingerIdxs;
        let bendAxis = new THREE.Vector3();
        let splayAxis = new THREE.Vector3();
        let fingerDir = new THREE.Vector3();

        let tempM3_0 = new THREE.Matrix3();
        let tempV3_0 = new THREE.Vector3();
        let tempV3_1 = new THREE.Vector3();

        let result = { bendAxes: [], splayAxes: [], bindQuats: [] };  // although called bindQuats, thumb does not have its actual bind
        this.bendRange = 4; // [1,9]
        
        // Z axis of avatar from mesh space to world space
        tempM3_0.setFromMatrix4( bones[ 0 ].matrixWorld.clone().multiply( this.skeleton.boneInverses[0] ) );
        let worldZ = this.config.axes[2].clone().applyMatrix3( tempM3_0 ).normalize();
        
        // thumb only
        let thumb = fingers[0];
        for ( let i = 0; i < 3; ++i ){
            tempM3_0.setFromMatrix4( bones[ thumb + i ].matrixWorld ).invert(); // World to Local
            tempV3_0.setFromMatrixPosition( bones[ thumb + i ].matrixWorld );
            tempV3_1.setFromMatrixPosition( bones[ thumb + i + 1 ].matrixWorld );
            fingerDir.subVectors( tempV3_1, tempV3_0 ).normalize(); // finger direction 
            bendAxis.crossVectors( worldZ, fingerDir ).normalize(); // assuming Tpose. Thumb is positioned different than other fingers
            let bendLocal = bendAxis.clone().applyMatrix3( tempM3_0 ); // from world to local space
            bendLocal.applyQuaternion( bones[ thumb + i ].quaternion ).normalize(); // from local to afterbind space
            let bindQuat = bones[ thumb + i ].quaternion.clone();

            if ( i == 0 ){
                splayAxis.crossVectors( bendAxis, fingerDir ).normalize(); // assuming Tpose
                if ( !isLeftHand ){ splayAxis.multiplyScalar( -1 ); }
                let splayLocal = splayAxis.clone().applyMatrix3( tempM3_0 ).normalize(); // from world to local space    
                splayLocal.applyQuaternion( bones[ thumb + i ].quaternion ).normalize(); // from local to afterbind space
                
                //assuming bones are in bind pose
                // compute quat so thumb is straight and parallel to fingers instead of whatever pose it is in the mesh
                let currentThumbDir = new THREE.Vector3();
                tempV3_0.setFromMatrixPosition( bones[ thumb ].matrixWorld );
                tempV3_1.setFromMatrixPosition( bones[ thumb + 1 ].matrixWorld );
                currentThumbDir.subVectors( tempV3_1, tempV3_0 ).normalize();

                let targetThumbDir = new THREE.Vector3();
                tempV3_0.setFromMatrixPosition( bones[ fingers[3] ].matrixWorld ); // middle finger - base joint
                tempV3_1.setFromMatrixPosition( bones[ fingers[3] + 2 ].matrixWorld ); // middle finger - pad joint
                targetThumbDir.subVectors( tempV3_1, tempV3_0 ).normalize();
                // targetThumbDir.multiplyScalar( Math.cos(60*Math.PI/180) ).addScaledVector( worldZ, Math.sin(60*Math.PI/180) );
                tempV3_0.crossVectors( targetThumbDir, worldZ ).normalize();
                tempV3_0.cross( targetThumbDir ).normalize();
                targetThumbDir.multiplyScalar( Math.cos(60*Math.PI/180) ).addScaledVector( tempV3_0, Math.sin(60*Math.PI/180) );
                
                let thumbProjection = { x: bendAxis.dot(currentThumbDir), y: splayAxis.dot(currentThumbDir), z: fingerDir.dot(currentThumbDir) };
                let targetProjection = { x: bendAxis.dot(targetThumbDir), y: splayAxis.dot(targetThumbDir), z: fingerDir.dot(targetThumbDir) };
                let thumbAngles = { elevation: - Math.asin( thumbProjection.y ), bearing: Math.atan2( thumbProjection.x, thumbProjection.z) };
                let targetAngles = { elevation: - Math.asin( targetProjection.y ), bearing: Math.atan2( targetProjection.x, targetProjection.z) };

                bindQuat.set(0,0,0,1);
                bindQuat.premultiply( this._tempQ_0.setFromAxisAngle( splayLocal, -thumbAngles.bearing    * (isLeftHand ? -1 : 1) ) );
                bindQuat.premultiply( this._tempQ_0.setFromAxisAngle( bendLocal,  -thumbAngles.elevation  * (isLeftHand ? -1 : 1) ) );
                bindQuat.premultiply( this._tempQ_0.setFromAxisAngle( bendLocal,   targetAngles.elevation * (isLeftHand ? -1 : 1) ) );
                bindQuat.premultiply( this._tempQ_0.setFromAxisAngle( splayLocal,  targetAngles.bearing   * (isLeftHand ? -1 : 1) ) );
                bindQuat.normalize();
                bindQuat.multiply( bones[ thumb + i ].quaternion );
 
                // recompute afterbind axes
                splayLocal.copy( splayAxis ).applyMatrix3( tempM3_0 ).applyQuaternion( bindQuat ).normalize(); // from world to afterbind space    
                bendLocal.copy( bendAxis ).applyMatrix3( tempM3_0 ).applyQuaternion( bindQuat ).normalize(); // from world to afterbind space
                result.splayAxes.push( splayLocal ); 
            }
            result.bendAxes.push( bendLocal );
            result.bindQuats.push( bindQuat );
        }

        // fingers - no thumb
        let bendBaseTweak = [0, -6*Math.PI/180, 0, 6*Math.PI/180, 7*Math.PI/180 ];
        for ( let f = 1; f < fingers.length; ++f ){
            // assuming Tpose
            tempV3_0.setFromMatrixPosition( bones[ fingers[f] ].matrixWorld );
            tempV3_1.setFromMatrixPosition( bones[ fingers[f] + 2 ].matrixWorld );
            fingerDir.subVectors( tempV3_1, tempV3_0 ).normalize();
            splayAxis.crossVectors( fingerDir, worldZ ).normalize(); 
            bendAxis.crossVectors( splayAxis, fingerDir ).normalize(); 
            for ( let i = 0; i < 3; ++i ){
                let bendLocal = bendAxis.clone(); 
                tempM3_0.setFromMatrix4( bones[ fingers[f] + i ].matrixWorld ).invert();
                if ( i == 0 ){
                    let splayLocal = splayAxis.clone(); 
                    splayLocal.applyMatrix3( tempM3_0 ); // from world to local space
                    splayLocal.applyQuaternion( bones[ fingers[f] + i ].quaternion ).normalize(); // from local to afterbind space
                    result.splayAxes.push(splayLocal);    

                    bendLocal.multiplyScalar( Math.cos( bendBaseTweak[f] ) ).addScaledVector( fingerDir, Math.sin( bendBaseTweak[f] ) ); // so fingers rotate a bit inwards
                }
                if ( isLeftHand ){ bendLocal.multiplyScalar( -1 ); }
                bendLocal.applyMatrix3( tempM3_0 ); // from world to local space
                bendLocal.applyQuaternion( bones[ fingers[f] + i ].quaternion ).normalize(); // from local to afterbind space 
                // let arrow = new THREE.ArrowHelper( bendLocal, new THREE.Vector3(0,0,0), 10, 0xff0000 ); bones[ fingers[f] + i ].add( arrow );
                result.bendAxes.push( bendLocal ); // from world to local space
                result.bindQuats.push( bones[ fingers[f] + i ].quaternion.clone() ); // assuming already in TPose
            }
        }
        
        return result;
    }
    
    _computeLookUpTables( ){
        let tempV3_0 = new THREE.Vector3();
        let tempV3_1 = new THREE.Vector3();
        let tempV3_2 = new THREE.Vector3();
        let bones = this.skeleton.bones;

        // set in "bind" pose (thumb is modified)
        for( let i = 0; i < 5; ++i ){
            for( let j = 0; j < 3; ++j ){
                this.skeleton.bones[ this.fingerIdxs[i] + j ].quaternion.copy( this.fingerAxes.bindQuats[ i*3 + j ] );
            }
        }

        // compute some important values
        let palmOutVec = new THREE.Vector3();
        let palmLateralVec = new THREE.Vector3();
        let palmUpVec = new THREE.Vector3();
        let thumbSizeUpper = 0;
        let thumbSizeFull = 0;
        let fingerWidth = 0;
        
        // approximate thumb sizes
        bones[ this.fingerIdxs[0] + 0 ].getWorldPosition( tempV3_0 );
        bones[ this.fingerIdxs[0] + 3 ].getWorldPosition( tempV3_1 );
        thumbSizeFull = tempV3_2.subVectors( tempV3_1, tempV3_0 ).length();
        bones[ this.fingerIdxs[0] + 1 ].getWorldPosition( tempV3_0 );
        thumbSizeUpper = tempV3_2.subVectors( tempV3_1, tempV3_0 ).length();
        this.handLocations[ "2_MID_ULNAR" ].getWorldPosition( tempV3_1 );
        this.handLocations[ "2_MID_RADIAL" ].getWorldPosition( tempV3_0 );
        fingerWidth = tempV3_2.subVectors( tempV3_1, tempV3_0 ).length();

        // palmOutVec
        bones[ this.fingerIdxs[1] ].getWorldPosition( tempV3_0 ); // index finger
        bones[ this.fingerIdxs[3] ].getWorldPosition( tempV3_1 ); // ring finger
        bones[ this.wristIdx ].getWorldPosition( tempV3_2 );
        tempV3_0.sub( tempV3_2 );
        tempV3_1.sub( tempV3_2 );
        palmOutVec.crossVectors( tempV3_0, tempV3_1 ).multiplyScalar( this.isLeftHand ? -1 : 1 ).normalize();

        // palmLateralVec
        bones[ this.fingerIdxs[3] ].getWorldPosition( tempV3_0 );
        bones[ this.fingerIdxs[3] + 2 ].getWorldPosition( tempV3_1 );
        palmLateralVec.subVectors( tempV3_1, tempV3_0 ).cross( palmOutVec ).multiplyScalar( this.isLeftHand ? -1 : 1 ).normalize();

        // palmUpVec
        palmUpVec.crossVectors( palmOutVec, palmLateralVec ).multiplyScalar( this.isLeftHand ? -1 : 1 ).normalize(); 

        // store vectors in local wrist space
        this.thumbThings = {};
        let m4 = bones[ this.wristIdx ].matrixWorld.clone().invert();
        let m3 = ( new THREE.Matrix3() ).setFromMatrix4( m4 );
        this.thumbThings.palmOutVec = palmOutVec.clone().applyMatrix3( m3 );
        this.thumbThings.palmLateralVec = palmLateralVec.clone().applyMatrix3( m3 );
        this.thumbThings.palmUpVec = palmUpVec.clone().applyMatrix3( m3 );
        this.thumbThings.thumbSizeUpper = thumbSizeUpper; // TODO store it in local coords. Currently in world size
        this.thumbThings.thumbSizeFull = thumbSizeFull; // TODO store it in local coords. Currently in world size
        this.thumbThings.fingerWidth = fingerWidth;

        this.angleRanges = this.config.fingerAngleRanges;
        // this.angleRanges = [ // in case of config...
        //     [ [ 0, 75*Math.PI/180 ] ],//[ [ 0, Math.PI * 0.2 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.4 ], [ 0, Math.PI * 0.4 ] ],  // [ splay, base, mid, high ]
        //     [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
        //     [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
        //     [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
        //     [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
        // ];

        // *** Thumbshapes ***
        this.thumbshapes = {
            OUT:     null,
            DEFAULT: null,
            OPPOSED: null,
            ACROSS:  null
        }

        // thumbshape: OUT
        bones[ this.fingerIdxs[1] ].getWorldPosition( tempV3_0 ).addScaledVector( palmLateralVec, thumbSizeUpper * 1.2 );
        this.thumbIK( tempV3_0, true ); // do not bend tip
        this.thumbshapes.OUT = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ];

        // thumbshape: OPPOSED 
        bones[ this.fingerIdxs[1] ].getWorldPosition( tempV3_0 ).addScaledVector( palmOutVec, thumbSizeFull )
        this.thumbIK( tempV3_0, false );
        this.thumbshapes.OPPOSED = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ];

        // thumbshape: DEFAULT
        this.handLocations[ "2_BASE_PALMAR" ].getWorldPosition( tempV3_0 );
        tempV3_0.addScaledVector( palmLateralVec, fingerWidth*1.5 );
        this.thumbIK( tempV3_0, true );
        this.thumbshapes.DEFAULT = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ];

        // thumbshape: ACROSS
        this.handLocations[ "5_BASE_PALMAR" ].getWorldPosition( tempV3_0 );
        tempV3_0.addScaledVector( palmOutVec, fingerWidth*0.5 );
        this.thumbIK( tempV3_0, false, 0 );
        this.thumbshapes.ACROSS = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ];


        // *** Basic and ThumbCombination Handshapes *** 
        // set in "bind" pose (thumb is modified)
        for( let i = 0; i < 5; ++i ){
            for( let j = 0; j < 3; ++j ){
                bones[ this.fingerIdxs[i] + j ].quaternion.copy( this.fingerAxes.bindQuats[ i*3 + j ] );
                bones[ this.fingerIdxs[i] + j ].updateWorldMatrix();
            }
        }

        let handshapes = this.handshapes = {
            // basic handshapes    
            FIST:            { selected: [0,0,0,0,0], defaultThumb: this.thumbshapes.DEFAULT, thumbOptions: null, fingers: [ [0,1,1,1],[0,1,1,1],[0,1,1,1],[0,1,1,1] ] },
            FINGER_2:        { selected: [0,1,0,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0,0,0],[0,1,1,1],[0,1,1,1],[0,1,1,1] ] },
            FINGER_23:       { selected: [0,1,1,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0,0,0],[0,0,0,0],[0,1,1,1],[0,1,1,1] ] },
            FINGER_23_SPREAD:{ selected: [0,1,1,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0.8,0,0,0],[-0.2,0,0,0],[0,1,1,1],[0,1,1,1] ] },
            FINGER_2345:     { selected: [0,1,1,1,1], defaultThumb: this.thumbshapes.DEFAULT, thumbOptions: null, fingers: [ [0.8,0,0,0],[0,0,0,0],[0.8,0,0,0],[0.8,0,0,0] ] },
            FLAT:            { selected: [0,1,1,1,1], defaultThumb: this.thumbshapes.DEFAULT, thumbOptions: null, fingers: [ [0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0] ] },
            // thumb combinations
            PINCH_12:        { selected: [2,2,0,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.7,0.4,0.25],[0,1,1,1],[0,1,1,1],[0,1,1,1] ] },
            PINCH_12_OPEN:   { selected: [2,2,0,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.7,0.4,0.25],[0,0.4,0.2,0.2],[0,0.2,0.2,0.2],[0,0,0.2,0.2] ] },
            PINCH_ALL:       { selected: [2,2,2,2,2], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.7,0.4,0.25],[0,0.7,0.34,0.26],[0,0.7,0.3,0.23],[0,0.89,0.22,0.22] ] },

            CEE_12:          { selected: [3,3,0,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.6,0.4,0.2],[0,1,1,1],[0,1,1,1],[0,1,1,1] ] }, 
            CEE_12_OPEN:     { selected: [3,3,0,0,0], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.6,0.4,0.2],[0,0.4,0.2,0.2],[0,0.2,0.2,0.1],[0,0,0.2,0.2] ] },
            CEE_ALL:         { selected: [3,3,3,3,3], defaultThumb: null, thumbOptions: [], fingers: [ [0,0.6,0.4,0.2],[0,0.6,0.4,0.2],[0,0.6,0.4,0.1],[0,0.6,0.4,0.2] ] }
        };

        // finger_2, finger_23, finger_23_spread thumbs
        let shape = handshapes.FIST;
        this._setFingers( shape.fingers[0], shape.fingers[1], shape.fingers[2], shape.fingers[3] );
        for( let i = 2; i < 6; ++i ){
            this.handLocations[ i.toString() + "_MID_RADIAL" ].getWorldPosition( tempV3_0 );
            this.thumbIK( tempV3_0, true );
            let thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            handshapes.FINGER_2.thumbOptions.push( thumbQuats );    
            handshapes.FINGER_23.thumbOptions.push( thumbQuats );    
            handshapes.FINGER_23_SPREAD.thumbOptions.push( thumbQuats );    
        }
        handshapes.FINGER_2.defaultThumb = handshapes.FINGER_2.thumbOptions[1]; // thumb to middle
        handshapes.FINGER_23.defaultThumb = handshapes.FINGER_23.thumbOptions[2]; // thumb to ring
        handshapes.FINGER_23_SPREAD.defaultThumb = handshapes.FINGER_23_SPREAD.thumbOptions[2]; // thumb to ring

        // pinch_12, pinch_12_open, cee_12, cee_12_open thumbs
        shape = handshapes.PINCH_ALL;
        this._setFingers( shape.fingers[0], shape.fingers[1], shape.fingers[2], shape.fingers[3] );
        for( let i = 2; i < 6; ++i ){
            this.handLocations[ i.toString() + "_TIP" ].getWorldPosition( tempV3_0 );
            this.thumbIK( tempV3_0, false );
            let thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            handshapes.PINCH_12.thumbOptions.push( thumbQuats );    
            handshapes.PINCH_12_OPEN.thumbOptions.push( thumbQuats );    
            handshapes.PINCH_ALL.thumbOptions.push( thumbQuats );    
            
            // reuse pinch position to compute CEE thumb, opening it
            tempV3_0.addScaledVector( palmOutVec, thumbSizeUpper ); // openin thumb
            this.thumbIK( tempV3_0, false );
            thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            handshapes.CEE_12.thumbOptions.push( thumbQuats );    
            handshapes.CEE_12_OPEN.thumbOptions.push( thumbQuats );  
            handshapes.CEE_ALL.thumbOptions.push( thumbQuats );  
        }
        handshapes.PINCH_12.defaultThumb = handshapes.PINCH_12.thumbOptions[0]; // thumb to index
        handshapes.PINCH_12_OPEN.defaultThumb = handshapes.PINCH_12_OPEN.thumbOptions[0]; // thumb to index
        handshapes.PINCH_ALL.defaultThumb = handshapes.PINCH_ALL.thumbOptions[1]; // thumb to middle
        handshapes.CEE_12.defaultThumb = handshapes.CEE_12.thumbOptions[0]; // thumb to index
        handshapes.CEE_12_OPEN.defaultThumb = handshapes.CEE_12_OPEN.thumbOptions[0]; // thumb to index
        handshapes.CEE_ALL.defaultThumb = handshapes.CEE_ALL.thumbOptions[1]; // thumb to middle
        
        // *** Bendings ***
        // [2].t might containe null OR an array with 4 arrays (one per finger) with 3 quaternions
        let handBendings = this.handBendings = {
            STRAIGHT:       { 1: [0,0,0,0],       2:{ t: null, f:[0,0,0,0] } }, 
            HALF_BENT:      { 1: [0,0.5,0,0],     2:{ t:[], f:[0,0.5,0,0] } }, 
            BENT:           { 1: [0,1,0,0],       2:{ t:[], f:[0,1,0,0] } }, 
            ROUND:          { 1: [0,0.5,0.5,0.5], 2:{ t:[], f:[0,5/9,6/9,9/9] } }, 
            HOOKED:         { 1: [0,0,1,1],       2:{ t:[], f:[0,1,1,8/9] } }, 
            DOUBLE_BENT:    { 1: [0,1,1,0],       2:{ t:[], f:[0,1,1,8/9] } }, // [2] reference from hooked 
            DOUBLE_HOOKED:  { 1: [0,1,1,1],       2:{ t:[], f:[0,1,1,8/9] } }, // [2] reference from hooked
        }

        this._setFingers( handBendings.BENT[2].f, handBendings.BENT[2].f, handBendings.BENT[2].f, handBendings.BENT[2].f );
        for( let i = 2; i < 6; ++i ){
            this.handLocations[ i.toString() + "_TIP" ].getWorldPosition( tempV3_0 );
            this.thumbIK( tempV3_0, false );
            let thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            handBendings.BENT[2].t.push( thumbQuats );    

            thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            nlerpQuats( thumbQuats[0], thumbQuats[0], this.thumbshapes.DEFAULT[0], 0.10 );
            nlerpQuats( thumbQuats[1], thumbQuats[1], this.thumbshapes.DEFAULT[1], 0.10 );
            nlerpQuats( thumbQuats[2], thumbQuats[2], this.thumbshapes.DEFAULT[2], 0.10 );
            handBendings.HALF_BENT[2].t.push( thumbQuats );
        }

        this._setFingers( handBendings.ROUND[2].f, handBendings.ROUND[2].f, handBendings.ROUND[2].f, handBendings.ROUND[2].f );
        for( let i = 2; i < 6; ++i ){
            this.handLocations[ i.toString() + "_PAD_BACK" ].getWorldPosition( tempV3_0 );
            this.thumbIK( tempV3_0, false );
            let thumbQuats = [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ]
            handBendings.ROUND[2].t.push( thumbQuats );
        }

        this._setFingers( handBendings.HOOKED[2].f, handBendings.HOOKED[2].f, handBendings.HOOKED[2].f, handBendings.HOOKED[2].f );
        for( let i = 2; i < 6; ++i ){
            this.handLocations[ i.toString() + "_MID_BACK" ].getWorldPosition( tempV3_0 );
            this.thumbIK( tempV3_0, i < 4 ); // target with thumb tip for ring and pinky. Target with thumb pad joint for middle and index
            handBendings.HOOKED[2].t.push( [ bones[ this.fingerIdxs[0] ].quaternion.clone(), bones[ this.fingerIdxs[0] + 1 ].quaternion.clone(), bones[ this.fingerIdxs[0] + 2 ].quaternion.clone(), ] );
        }
        handBendings.DOUBLE_BENT[2].t = handBendings.HOOKED[2].t; // reference
        handBendings.DOUBLE_HOOKED[2].t = handBendings.HOOKED[2].t; // reference

    }
    
    // get from bones
    _getThumb( resultQuats ){
        resultQuats[0].copy( this.skeleton.bones[ this.fingerIdxs[0] ].quaternion );
        resultQuats[1].copy( this.skeleton.bones[ this.fingerIdxs[0] + 1 ].quaternion );
        resultQuats[2].copy( this.skeleton.bones[ this.fingerIdxs[0] + 2 ].quaternion );
    }

    _setThumb( thumbQuats ){
        this.skeleton.bones[ this.fingerIdxs[0] ].quaternion.copy( thumbQuats[0] );
        this.skeleton.bones[ this.fingerIdxs[0] + 1 ].quaternion.copy( thumbQuats[1] );
        this.skeleton.bones[ this.fingerIdxs[0] + 2 ].quaternion .copy( thumbQuats[2] );
    }

    _setFingers( index, middle, ring, pinky ){
        // order of quaternion multiplication matter
        let bones = this.skeleton.bones;
        let bendAxes = this.fingerAxes.bendAxes; 
        let splayAxes = this.fingerAxes.splayAxes; 
        let fingers = this.fingerIdxs;
        
        // all finger bends
        bones[ fingers[1]     ].quaternion.setFromAxisAngle( bendAxes[3], this._computeBendAngle( index, 1, 1 ) );
        bones[ fingers[1] + 1 ].quaternion.setFromAxisAngle( bendAxes[4], this._computeBendAngle( index, 1, 2 ) );
        bones[ fingers[1] + 2 ].quaternion.setFromAxisAngle( bendAxes[5], this._computeBendAngle( index, 1, 3 ) );
 
        bones[ fingers[2]     ].quaternion.setFromAxisAngle( bendAxes[6],  this._computeBendAngle( middle, 2, 1 ) );
        bones[ fingers[2] + 1 ].quaternion.setFromAxisAngle( bendAxes[7],  this._computeBendAngle( middle, 2, 2 ) );
        bones[ fingers[2] + 2 ].quaternion.setFromAxisAngle( bendAxes[8],  this._computeBendAngle( middle, 2, 3 ) );

        bones[ fingers[3]     ].quaternion.setFromAxisAngle( bendAxes[9],  this._computeBendAngle( ring, 3, 1 ) );
        bones[ fingers[3] + 1 ].quaternion.setFromAxisAngle( bendAxes[10], this._computeBendAngle( ring, 3, 2 ) );
        bones[ fingers[3] + 2 ].quaternion.setFromAxisAngle( bendAxes[11], this._computeBendAngle( ring, 3, 3 ) );

        bones[ fingers[4]     ].quaternion.setFromAxisAngle( bendAxes[12], this._computeBendAngle( pinky, 4, 1 ) );
        bones[ fingers[4] + 1 ].quaternion.setFromAxisAngle( bendAxes[13], this._computeBendAngle( pinky, 4, 2 ) );
        bones[ fingers[4] + 2 ].quaternion.setFromAxisAngle( bendAxes[14], this._computeBendAngle( pinky, 4, 3 ) );

        // other fingers splay
        bones[ fingers[1] ].quaternion.multiply( this._tempQ_0.setFromAxisAngle(  splayAxes[1], this._computeSplayAngle( index, 1 ) ) );
        bones[ fingers[2] ].quaternion.multiply( this._tempQ_0.setFromAxisAngle(  splayAxes[2], this._computeSplayAngle( middle, 2 ) ) );
        bones[ fingers[3] ].quaternion.multiply( this._tempQ_0.setFromAxisAngle(  splayAxes[3], -1 * this._computeSplayAngle( ring, 3 ) ) );
        bones[ fingers[4] ].quaternion.multiply( this._tempQ_0.setFromAxisAngle(  splayAxes[4], -1 * this._computeSplayAngle( pinky, 4 ) - this._computeSplayAngle( ring, 3 ) ) );

        // apply bind quaternions
        for ( let i = 1; i < 5; ++i ){
            bones[ fingers[i]     ].quaternion.multiply(  this._tempQ_0.copy(this.fingerAxes.bindQuats[i*3]) );
            bones[ fingers[i] + 1 ].quaternion.multiply(  this._tempQ_0.copy(this.fingerAxes.bindQuats[i*3+1]) );
            bones[ fingers[i] + 2 ].quaternion.multiply(  this._tempQ_0.copy(this.fingerAxes.bindQuats[i*3+2]) );            
        }
    }
       
    // part=1 -> base joint, part=2 -> mid joint,  part=3 -> pad joint
    _computeBendAngle( fingerInfo, index, part ){
        let b = fingerInfo[ part ];
        // let baseBend = Math.min( 1, Math.max( -0.2, index[1] ) );// +  ( fingerplayResult ? fingerplayResult[1] : 0 ) ) );
        let r = this.angleRanges[index][part]; 
        return r[0]* (1-b) + r[1] * b; 
    }
    _computeSplayAngle( fingerInfo, index ){
        let t = fingerInfo[0] * ( 1 - Math.abs( fingerInfo[1] ) ); // splay * ( 1 - bendBase )
        let range = this.angleRanges[ index ][0];
        return  range[0] * (1-t) + range[1] * t;
    }

    // specialFingers is used only for the thumb in the pinch-cee combinations. In all other cases and for fingers, selectedFingers is used 
    _stringToMainBend( mainbend, handInfo, selectedFingers, specialFingers = null ){        
        if ( mainbend && mainbend.toUpperCase ){ mainbend = mainbend.toUpperCase(); }
        let b = this.handBendings[ mainbend ];
        if ( !b ){ return; }

        // thumb only in thumb combinations
        if ( selectedFingers[0] >= 2 ){
            let bt = b[2].t;
            
            // several thumb options. Needs to be specified depending on selected fingers
            if ( bt && bt.length > 3 ){ 
                if ( specialFingers && specialFingers.length ){ bt = bt[ specialFingers[0] - 1 ]; }
                else{ for( let i = 1; i < 5; ++i ){ if ( selectedFingers[i] ){ bt = bt[i-1]; break; } } }
            } 
            if ( !bt ){ bt = this.thumbshapes.DEFAULT; }

            handInfo.thumb = bt; // class setter 
        }

        // rest of fingers
        for( let i = 1; i < 5; ++i ){
            let s = selectedFingers[i]; 
            if ( !s ){ continue; }
            let f = ( s == 1 ) ? b[1] : b[2].f;
            // ignore splay from handbending
            let digitInfo = handInfo.getDigit( i );
            digitInfo[1] = s == 3 ? ( f[1] * 0.8 ) : f[1]; // CEE opens a bit all fingers with respect to thumb
            digitInfo[2] = f[2];
            digitInfo[3] = f[3]; 
        }
    }

    // selectMode: if str is not numbers,  0 does nothing, 1 same shapes as mainbend in basic handshape, 2 same as mainbend in thumbcombinations
    _stringToFingerBend( str, outFinger, selectMode = 0, bendRange = 4 ){
        if ( !str ){ return; }

        if ( typeof( str ) == "string" ){ str = str.toUpperCase(); }
        let b = this.handBendings[ str ];
        if ( !b ){ 
            if ( typeof( str ) == "string" ){
                // strings of three int values 0-9
                for( let i = 0; (i < 3) && (i < str.length); ++i ){
                    let val = parseInt( str[i] );
                    if ( isNaN(val) ){ continue; }
                    outFinger[1+i] = val / bendRange;
                }
            }
            return;
        }

        if ( !selectMode ){ return; }
        let f = ( selectMode == 1 ) ? b[1] : b[2].f;
        outFinger[1] = selectMode == 3 ? ( f[1] * 0.8 ) : f[1]; 
        outFinger[2] = f[2]; 
        outFinger[3] = f[3]; 
    }

    _stringToSplay( str, outFinger ){
        let val = str;
        if ( typeof val == "string" ){ 
            val = parseFloat( val );
        } 
        if ( isNaN(val) ){ return; }
        outFinger[0] = val;
    }

    // to avoid having duplicated code for main and second attributes. Fills outHand. Returns 0 on success, >0 otherwise
    _newGestureHandComposer( bml, outHand, isSecond ){
        /*
        outHand = [
            [quat, quat quat ]
            [s,b,b,b]
            [s,b,b,b]
            [s,b,b,b]
            [s,b,b,b]
        ]
        */

        let shapeName = isSecond ? bml.secondHandshape : bml.handshape;
        if ( shapeName && shapeName.toUpperCase ){ shapeName = shapeName.toUpperCase(); }
        let g = this.handshapes[ shapeName ];
        if ( !g ){ return false; }
            
        // copy selected shape into buffers  
        outHand.setDigits( g.defaultThumb, g.fingers[0], g.fingers[1], g.fingers[2], g.fingers[3] )
        
        let selectedFingers = g.selected;
        
        // special fingers override default
        let specFing = bml.specialFingers; // get special fingers
        if ( specFing && !isSecond ){
            let newSelectedFingers = [selectedFingers[0],0,0,0,0];
            specFing = specFing.split(''); // ['23'] -> ['2','3']
            for (let i = 0; i < specFing.length; i++) {
                let num = parseInt(specFing[i]) - 1;
                if (isNaN(num) || num < 1 || num > 4) { specFing.splice(i, 1); i--; continue; } // only fingers, no thumb
                newSelectedFingers[num] = (g.selected[0] ? g.selected[0] : 1); // depending on thumb, selected value is 1,2 or 3
                specFing[i] = num;
            } // str to num (['2', '3'] -> [1,2])
            
            if ( specFing.length ){ 
                selectedFingers = newSelectedFingers;
                switch (shapeName){
                    case "FIST":
                        for (let i = 1; i < selectedFingers.length; i++) {
                            if (!selectedFingers[i]) outHand.setDigit( i, [0,0,0,0] ); // non-selected fingers into flat
                            selectedFingers[i] = 1 - selectedFingers[i];
                        }
                        break;
                        
                    case "FLAT": case "CEE_ALL": case "PINCH_ALL":
                        for (let i = 1; i < selectedFingers.length; i++) {
                            if (!selectedFingers[i]) outHand.setDigit( i, [0,1,1,1] ); // non-selected fingers into fist
                        }
                        break;
                        
                    case "PINCH_12": case "PINCH_12_OPEN": case "CEE_12": case "CEE_12_OPEN": 
                        for (let i = 0; i < specFing.length; i++) {
                            outHand.setDigit( specFing[i], this.handshapes[ (shapeName.includes("CEE_") ? "CEE_ALL" : "PINCH_ALL") ].fingers[ specFing[i] - 1 ] );
                        }
                        break;
                        
                    default:
                        // get default fingers (handshapes: fingerX)
                        let defFing = shapeName.match(/\d+/g); // ['FINGER_23_SPREAD'] -> ['23']
                        if (defFing) {
                            defFing = defFing[0].split(''); // ['23'] -> ['2','3']
                            defFing = defFing.map(function(str) {
                                return parseInt(str) - 1;
                            }); // str to num (['2', '3'] -> [2,3])
                            if(defFing[0] == 0) defFing.shift(); // avoid thumb
                            
                            // change handshape
                            for (let i = 0; i < specFing.length; i++) {                                
                                if (!defFing[i]) { 
                                    outHand.setDigit( specFing[i], outHand.getDigit(defFing[0]) ); // copy array as value not reference
                                }  // if more special fingers than default
                                else if (specFing[i] == defFing[i]) { continue; } // default and special are the same finger -> skip
                                else { outHand.setDigit( specFing[i],outHand.getDigit(defFing[i]) ); } // interchange finger config (eg: default=2, special=5)
                            }
                        }
                        break;

                }
                // change unselected to open or fist
                let isOpen = shapeName.includes("_OPEN", 5);
                for (let i = 1; i < selectedFingers.length; i++) {
                    if (!selectedFingers[i]) { outHand.setDigit( i, (isOpen ? [0,0.2,0.2,0.2] : [0,1,1,1]) ); }
                }
                
                // relocate thumb if pinch or cee. All pinc_ cee_ are transformed into pinch_all cee_all
                if ( shapeName.includes("PINCH_") || shapeName.includes("CEE_") ){
                    let relocationThumbshape = shapeName.includes("PINCH_") ? this.handshapes.PINCH_ALL.thumbOptions : this.handshapes.CEE_ALL.thumbOptions;
                    relocationThumbshape = relocationThumbshape[ specFing[0] - 1 ]; // relocate to first specialFinger
                    outHand.thumb = relocationThumbshape;
                }       
                if ( shapeName == "FINGER_2" || shapeName == "FINGER_23" || shapeName == "FINGER_23_SPREAD" ){
                    let relocationFinger = 0; 
                    for( let i = 1; i < selectedFingers.length; ++i ){
                        if ( !selectedFingers[i] ){ relocationFinger = i; break; }
                    }
                    if ( relocationFinger ){ outHand.thumb = this.handshapes[ "FINGER_2" ].thumbOptions[ relocationFinger -1 ]; }
                    else { outHand.thumb = this.thumbshapes.DEFAULT; }
                }       
            }    
        } // end of special fingers

        // apply mainbends if any
        this._stringToMainBend( isSecond ? bml.secondMainBend : bml.mainBend, outHand, selectedFingers, specFing );

        // modify with thumbshape
        let thumbshapeName = isSecond ? bml.secondThumbshape : bml.thumbshape;
        if ( typeof( thumbshapeName ) == "string" ){ thumbshapeName = thumbshapeName.toUpperCase(); }
        let thumbGest = this.thumbshapes[ thumbshapeName ];
        if ( thumbGest ){ outHand.thumb = thumbGest; }

        // bml.tco (thumb combination opening). Applicable to cee and pinch (select mode 2 and 3). 1=keep original, 0=open fingers
        let thumbCombinationOpening = parseFloat( isSecond ? bml.secondtco : bml.tco );
        thumbCombinationOpening = isNaN( thumbCombinationOpening ) ? 0 : Math.max(-1, Math.min(1, thumbCombinationOpening ) );
        thumbCombinationOpening = 1- thumbCombinationOpening;
        for( let i = 1; i < 5; ++i ){
            outHand.shape[i][1] *= thumbCombinationOpening;
            outHand.shape[i][2] *= thumbCombinationOpening; 
            outHand.shape[i][3] *= thumbCombinationOpening; 
        }
        return true;
    }

    newGestureBML( bml ){
        let bones = this.skeleton.bones;
        let fingerIdxs = this.fingerIdxs;

        //copy "current" to "source". Swaping pointers not valid: when 2 instructions arrive at the same time, "source" would have wrong past data
        this.srcG.copy( this.curG );

        // compute gestures
        let shape = new HandInfo();
        let secondShape = new HandInfo();

        if ( !this._newGestureHandComposer( bml, shape, false ) ){ 
            console.warn( "Gesture: HandShape incorrect handshape \"" + bml.handshape + "\"" );
            return false; 
        };
        if ( this._newGestureHandComposer( bml, secondShape, true ) ){ 
            shape.lerp( secondShape, 0.5 );
        };

        // Jasigning uses numbers in a string for bend. Its range is 0-4. This realizer works with 0-9. Remap
        let bendRange = this.bendRange;
        // if ( bml.bendRange ){
        //     let newBend = parseInt( bml.bendRange );
        //     bendRange = isNaN( bendRange ) ? bendRange : newBend; 
        // }

        // specific bendings
        // this._stringToFingerBend( bml.bend1, this.trgG[0], 1, bendRange ); // thumb
        this._stringToFingerBend( bml.bend2, shape.index, 1, bendRange );
        this._stringToFingerBend( bml.bend3, shape.middle, 1, bendRange );
        this._stringToFingerBend( bml.bend4, shape.ring, 1, bendRange );
        this._stringToFingerBend( bml.bend5, shape.pinky, 1, bendRange );

        // check if any splay attributes is present. ( function already checks if passed argument is valid )           
        // this._stringToSplay( bml.splay1, this.trgG[0] ); // thumb
        this._stringToSplay( bml.splay2 ? bml.splay2 : bml.mainSplay, shape.index );
        this._stringToSplay( bml.splay3, shape.middle ); // not affected by mainsplay, otherwise it feels weird
        this._stringToSplay( bml.splay4 ? bml.splay4 : bml.mainSplay, shape.ring );
        this._stringToSplay( bml.splay5 ? bml.splay5 : bml.mainSplay, shape.pinky );


        this.trgG.copy( shape );

        // compute finger quaternions and thumb ik (if necessary)
        let thumbTarget = ( typeof( bml.thumbTarget ) == "string" ) ? this.handLocations[ bml.thumbTarget.toUpperCase() ] : null;
        if( thumbTarget ){
            this._setFingers( shape.index, shape.middle, shape.ring, shape.pinky );
            let targetPos = thumbTarget.getWorldPosition( new THREE.Vector3() );
            if( bml.thumbDistance ){ 
                let distance = isNaN( parseFloat( bml.thumbDistance ) ) ? 0 : bml.thumbDistance;
                let m3 = ( new THREE.Matrix3() ).setFromMatrix4( bones[ this.wristIdx ].matrixWorld );
                let palmOutVec = this.thumbThings.palmOutVec.clone().applyMatrix3( m3 ).normalize();
                targetPos.addScaledVector( palmOutVec, distance * this.thumbThings.thumbSizeFull );
            }
            this.thumbIK( targetPos, bml.thumbSource == "PAD", bml.thumbSplay );
            this._getThumb( this.trgG.thumb );
            
            // set quaternions as they were before ik
            this._setFingers( this.srcG.index, this.srcG.middle, this.srcG.ring, this.srcG.pinky );
            this._setThumb( this.srcG.thumb );
        }

        if ( bml.shift ){
            this.defG.copy( this.trgG );
        }
        
        this.time = 0;
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.transition = true;
    }
}



class ExtfidirPalmor { 
    constructor( config, skeleton, isLeftHand = false ){
        this.skeleton = skeleton;
        this.isLeftHand = !!isLeftHand;

        this.config = config;
        let boneMap = config.boneMap;
        let handName = ( isLeftHand ) ? "L" : "R";
        let bones = this.skeleton.bones;

        this.wristIdx = boneMap[ handName + "Wrist" ];
        this.wristBone = bones[ this.wristIdx ];
        this.forearmBone = bones[ boneMap[ handName + "Elbow" ] ];

        this.wristBindQuat = getBindQuaternion( this.skeleton, this.wristIdx, new THREE.Quaternion() );
        // before-bind axes
        this.twistAxisForearm = ( new THREE.Vector3() ).copy( bones[ boneMap[ handName + "Wrist" ] ].position ).normalize(),
        this.twistAxisWrist = ( new THREE.Vector3() ).copy( bones[ boneMap[ handName + "HandMiddle" ] ].position ).normalize(),
        this.bearingAxis = ( new THREE.Vector3() ).crossVectors( bones[ boneMap[ handName + "HandRing" ] ].position, bones[ boneMap[ handName + "HandIndex" ] ].position ).multiplyScalar( isLeftHand ? -1: 1 ).normalize()
        this.elevationAxis = ( new THREE.Vector3() ).crossVectors( this.bearingAxis, this.twistAxisWrist ).normalize(); // compute elevation
        this.bearingAxis.crossVectors( this.twistAxisWrist, this.elevationAxis ).normalize(); // compute bearing
  
        this.palmor = {
            srcAngle: 0, // aprox
            trgAngle: 0,
            defAngle: 0,
        };

        this.extfidir = {
            trgDir: new THREE.Vector3(0,-1,0),
            defDir: new THREE.Vector3(0,-1,0),
        };

        this.curAproxPalmor = 0;
        this.srcQuat = new THREE.Quaternion(0,0,0,1);
        this.curQuat = new THREE.Quaternion(0,0,0,1);
        
        this.time = 0; // current time of transition
        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0; 
        this.end = 0;
        this.transition = false;
        this.reset();

        this._tempMat3_0 = new THREE.Matrix3();
        this._tempV3_0 = new THREE.Vector3(); // world pos and cross products
        this._tempV3_1 = new THREE.Vector3(); // z axis
        this._tempV3_2 = new THREE.Vector3(); // x axis
        this._tempV3_3 = new THREE.Vector3(); // y axis
        this._tempQ_0 = new THREE.Quaternion();
    }

    reset() {
        // Force pose update to flat
        this.transition = false;
        this.curQuat.set(0,0,0,1);
        this.srcQuat.set(0,0,0,1);
        this.curAproxPalmor = 0;
        this.palmor.srcAngle = 0;
        this.palmor.trgAngle = 0;
        this.palmor.defAngle = 0;
        this.extfidir.trgDir.set(0,-1,0);
        this.extfidir.defDir.set(0,-1,0);
    }

    // compute the swing rotation so as to get the twistAxisWrist to point at a certain location. It finds the forearm twist correction
    _computeSwingFromCurrentPose( targetPoint, resultWristQuat ){
        let elevation = Math.atan2( targetPoint.y, Math.sqrt( targetPoint.x * targetPoint.x + targetPoint.z * targetPoint.z ) );
        let bearing = Math.atan2( targetPoint.x, targetPoint.z );
        
        // this solves ir
        if ( this.isLeftHand && bearing > 1.58825 ){ bearing -= Math.PI * 2; } 
        else if ( !this.isLeftHand && bearing < -1.58825 ){ bearing += Math.PI * 2; } 


        let wristBone = this.wristBone;
        wristBone.quaternion.copy( this.wristBindQuat );
        wristBone.updateWorldMatrix( true );

        let wToLMat3 = this._tempMat3_0.setFromMatrix4( wristBone.matrixWorld ).invert(); // gets only rotation (and scale)
        
        let worldZAxisToLocal = this._tempV3_1.set(0,0,1).applyMatrix3( wToLMat3 ).normalize();        
        let worldXAxisToLocal = this._tempV3_2.set(1,0,0).applyMatrix3( wToLMat3 ).normalize();        
        let worldYAxisToLocal = this._tempV3_3.crossVectors( worldZAxisToLocal, worldXAxisToLocal ).normalize();
        
        // make hand point out in world coordinates ( +Z )
        let angle = Math.acos( this.twistAxisWrist.dot( worldZAxisToLocal ) );
        let rotAx = this._tempV3_0;
        rotAx.crossVectors( this.twistAxisWrist, worldZAxisToLocal ).normalize();
        resultWristQuat.setFromAxisAngle( rotAx, angle );

        // adjust hand orientation so its palm is facing down in world coordinates ( 0,-1,0 )
        let newElevationAxis = this._tempV3_0.copy( this.elevationAxis ).applyQuaternion( resultWristQuat );
        angle = Math.acos( newElevationAxis.dot( worldXAxisToLocal ) );
        rotAx.crossVectors( newElevationAxis, worldXAxisToLocal ).normalize(); // should be worldZAxis, but sign might differ
        this._tempQ_0.setFromAxisAngle( rotAx, angle );
        resultWristQuat.premultiply( this._tempQ_0 );
      
        // now, add extfidir        
        let elevationRot = this._tempQ_0.setFromAxisAngle( worldXAxisToLocal, -elevation ); // -elevation because of how the axis is computed vs atan2
        resultWristQuat.premultiply( elevationRot );
        let bearingRot = this._tempQ_0.setFromAxisAngle( worldYAxisToLocal, bearing );
        resultWristQuat.premultiply( bearingRot );

        resultWristQuat.premultiply( this.wristBindQuat)

    }

    update(dt){
        this.wristBone.quaternion.copy( this.wristBindQuat );
        // if( !this.transition ){ return; }

        this.time += dt;
        if ( this.time < this.start ){ 
            this.wristBone.quaternion.copy( this.srcQuat );
        }
        else if ( this.time < this.attackPeak ){      
            this._computeSwingFromCurrentPose( this.extfidir.trgDir, this.curQuat );
            this._tempQ_0.setFromAxisAngle( this.twistAxisWrist, this.palmor.trgAngle );
            this.curQuat.multiply( this._tempQ_0 );
            let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
            nlerpQuats( this.curQuat, this.srcQuat, this.curQuat, t );
            //this.curQuat.slerpQuaternions( this.srcQuat, this.curQuat, t );

            this.curAproxPalmor = this.palmor.srcAngle * (1-t) + this.palmor.trgAngle * t;
            this.wristBone.quaternion.copy( this.curQuat );
        }
        else if ( this.time < this.relax ){ 
            this._computeSwingFromCurrentPose( this.extfidir.trgDir, this.curQuat );
            this._tempQ_0.setFromAxisAngle( this.twistAxisWrist, this.palmor.trgAngle );
            this.curQuat.multiply( this._tempQ_0 );
            this.wristBone.quaternion.copy( this.curQuat );
            this.curAproxPalmor = this.palmor.trgAngle;
        }
        else { 
            this._computeSwingFromCurrentPose( this.extfidir.trgDir, this.srcQuat );
            this._tempQ_0.setFromAxisAngle( this.twistAxisWrist, this.palmor.trgAngle );
            this.srcQuat.multiply( this._tempQ_0 );

            this._computeSwingFromCurrentPose( this.extfidir.defDir, this.curQuat );
            this._tempQ_0.setFromAxisAngle( this.twistAxisWrist, this.palmor.defAngle );
            this.curQuat.multiply( this._tempQ_0 );

            let t = ( this.time - this.relax ) / ( this.end - this.relax );
            if ( t > 1 ){ 
                t = 1; 
                this.transition = false;
            }
            nlerpQuats( this.curQuat, this.srcQuat, this.curQuat, t );
            //this.curQuat.slerpQuaternions( this.srcQuat, this.curQuat, t ); 
            this.wristBone.quaternion.copy( this.curQuat );
            this.curAproxPalmor = this.palmor.trgAngle * (1-t) + this.palmor.defAngle * t;

        }
    }


    /**
     * bml info
     * start, attackPeak, relax, end
     * extfidir: string from sides
     * secondExtfidir: (optional) string from sides. Will compute midpoint between extifidir and secondExtfidir
    */
    newGestureBMLExtfidir( bml, symmetry = false ){
        if( !bml.extfidir ){ return; }
        
        if( !stringToDirection( bml.extfidir, this.extfidir.trgDir, symmetry, true ) ){ 
            console.warn( "Gesture: Extfidir incorrect direction \"" + bml.extfidir + "\"" );
            return false; 
        }
        this.extfidir.trgDir.normalize();
        if( stringToDirection( bml.secondExtfidir, this._tempV3_0, symmetry, true ) ){
            this.extfidir.trgDir.lerpVectors( this.extfidir.trgDir, this._tempV3_0, 0.5 );
            this.extfidir.trgDir.normalize();
        }
        
        // set defualt point if necessary
        if( bml.shift ){
            this.extfidir.defDir.copy( this.extfidir.trgDir );
        }  
        return true;  
    }

    /**
     * bml info
     * start, attackPeak, relax, end
     * palmor: string from palmorRightTable
     * secondPalmor: (optional)
    */
    newGestureBMLPalmor( bml, symmetry = 0x00 ){
        if( !bml.palmor ){ return; }

        // TODO (?): solve atan2(0,-0) == up    
        let result = this._tempV3_0;
        if ( !stringToDirection( bml.palmor, result, symmetry, true ) ){ return false; }
        let angle = Math.atan2( result.x, -result.y ); // -y so down is angle=0º
        
        if ( stringToDirection( bml.secondPalmor, result, symmetry, true ) ){ 
            let secondAngle = Math.atan2( result.x, -result.y ); // -y so down is angle=0º
            // find shortest path between angle and secondAngle. 
            // TODO (?): simply interpolate result vectors instead of angles to avoid this if
            if( Math.abs( angle - secondAngle ) > Math.PI ){
                if( ( angle - secondAngle ) < 0 ){ secondAngle -= 2 * Math.PI; }
                else{ secondAngle += 2 * Math.PI; }
            }
            angle = ( angle + secondAngle ) * 0.5
        }
        if ( !this.isLeftHand && angle < -120 * Math.PI/180 ){ angle += Math.PI *2; }
        else if ( this.isLeftHand && angle > 120 * Math.PI/180 ){ angle -= Math.PI *2; }
        // if ( !this.isLeftHand && angle < -140 * Math.PI/180 ){ angle += Math.PI *2; }
        // else if ( this.isLeftHand && angle > 140 * Math.PI/180 ){ angle -= Math.PI *2; }
        
        this.palmor.trgAngle = angle;

        // set defualt pose if necessary
        if ( bml.shift ){
            this.palmor.defAngle = this.palmor.trgAngle;
        }

        return true;
    }

    newGestureBML( bml, symmetry = 0x00 ){

        this.srcQuat.copy( this.curQuat );
        this.palmor.srcAngle = this.curAproxPalmor;

        if ( !this.newGestureBMLExtfidir( bml, symmetry ) ){
            if ( this.time > this.relax ){ this.extfidir.trgDir.copy( this.extfidir.defDir ); }
            // this.extfidir.trgDir.copy( this.extfidir.defDir );
        }
        symmetry = (symmetry & 0xfe) | ( ( symmetry & 0x01 ) ^ ( this.extfidir.trgDir.z < 0 ? 0x01 : 0x00 ) );
        if ( !this.newGestureBMLPalmor( bml, symmetry ) ){
            if ( this.time > this.relax ){ this.palmor.trgAngle = this.palmor.defAngle; }
            // this.palmor.trgAngle = this.palmor.defAngle;
        }

        this.time = 0;
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.transition = true; 

        return true;
    }
}




class LocationBodyArm {
    constructor( config, skeleton, isLeftHand = false ) {
        this._tempV3_0 = new THREE.Vector3();
        this._tempV3_1 = new THREE.Vector3();
        this._tempV3_2 = new THREE.Vector3();
        
        this.skeleton = skeleton;
        this.config = config;
        this.bodyLocations = config.bodyLocations;
        this.handLocations = isLeftHand ? config.handLocationsL : config.handLocationsR;
        this.isLeftHand = !!isLeftHand;
        
        let boneMap = config.boneMap;
        let handName = isLeftHand ? "L" : "R";
        this.idx = {
            shoulder: boneMap[ handName + "Shoulder" ],
            arm: boneMap[ handName + "Arm" ],
            elbow: boneMap[ handName + "Elbow" ],
            wrist: boneMap[ handName + "Wrist" ]
        }
        
        // p : without offset. Raw location interpolation
        this.cur = { p: new THREE.Vector3(), offset: new THREE.Vector3() }; // { world point, elbow raise, offset due to previous motions+handconstellation }
        this.src = { p: new THREE.Vector3(), offset: new THREE.Vector3() }; // { world point, elbow raise, offset due to previous motions+handconstellation }
        this.trg = new THREE.Vector3();
        this.def = new THREE.Vector3();

        // if not null, this will be de point that tries to reach the target. Otherwise, the wrist is assumed
        this.contactFinger = null;
        this.keepUpdatingContact = false; // flag to enable constant update of target position. If disabled, contact is only updated during start-peak 
        this.contactUpdateDone = false; // internal flag to indicate final contact update into this.trg has been done. Always false when keepUpdatingContact == true

        this.time = 0; // current time of transition
        this.start = 0; 
        this.attackPeak = 0;
        this.relax = 0;
        this.end = 0;
        
        this.transition = false;

        
        this.worldArmSize = 0;
        this.skeleton.bones[ boneMap[ handName + "Arm" ] ].getWorldPosition( this._tempV3_0 );
        this.skeleton.bones[ boneMap[ handName + "Elbow" ] ].getWorldPosition( this._tempV3_1 );
        this.skeleton.bones[ boneMap[ handName + "Wrist" ] ].getWorldPosition( this._tempV3_2 );
        this.worldArmSize = this._tempV3_0.sub( this._tempV3_1 ).length() + this._tempV3_1.sub( this._tempV3_2 ).length();
        
        // set default poses
        this.reset();
    }

    reset(){
        this.transition = false;
        this.contactFinger = null;
        this.cur.p.set(0,0,0);
        this.def.set(0,0,0);

        this.keepUpdatingContact = false;
        this.contactUpdateDone = false;
    }

    update( dt ){
        // nothing to do
        if ( !this.transition ){ return; } 
        
        this.time += dt;
        
        // wait in same pose
        if ( this.time < this.start ){ 
            // this.cur.p.copy( this.src.p ); 
        }
        else if ( this.time >= this.end ){
            this.cur.p.copy( this.def );
            this.cur.offset.set(0,0,0); // just in case
            this.transition = false; // flag as "nothing to do"
        }
        else{
            let newTarget = this._tempV3_0.copy( this.trg );

            if ( this.contactFinger && !this.contactUpdateDone ){ // use some finger instead of the wrist
                this.contactFinger.updateWorldMatrix( true ); // self and parents
                
                this._tempV3_1.setFromMatrixPosition( this.contactFinger.matrixWorld );
                this._tempV3_2.setFromMatrixPosition( this.skeleton.bones[ this.idx.wrist ].matrixWorld );

                let dir = this._tempV3_1.sub( this._tempV3_2 );
                newTarget.sub( dir );

                // stop updating after peak, if keepUpdating is disabled. Hold last newTarget value as target
                if ( !this.keepUpdatingContact && this.time >= this.attackPeak ){
                    this.contactUpdateDone = true;
                    this.trg.copy( newTarget );
                }
            }
            
            
            // interpolations
            if ( this.time > this.attackPeak && this.time < this.relax ){ 
                this.cur.p.copy( newTarget );
                this.cur.offset.set(0,0,0);
            }            
            else if ( this.time <= this.attackPeak ){
                let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
                if ( t > 1){ t = 1; }
                t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;
    
                this.cur.offset.copy( this.src.offset ).multiplyScalar( 1 - t );
                this.cur.p.lerpVectors( this.src.p, newTarget, t );
                
                // overwriting newTarget ( aka this._tempV3_0 ). Add curve on the z axis (slightly better visually)
                let extraZSizeFactor = Math.min( 1, newTarget.sub( this.src.p ).lengthSq() / (this.worldArmSize * this.worldArmSize * 0.5) );
                let extraZsize = this.worldArmSize * 0.3 * extraZSizeFactor; // depending on how far the next objective
                this.cur.p.z += 2 * extraZsize * t * (1-t); // bezier simplified     [ 0 | size | 0 ]
            }    
            else if ( this.time >= this.relax ){
                let t = ( this.time - this.relax ) / ( this.end - this.relax );
                if ( t > 1){ t = 1; }
                t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;
    
                this.cur.offset.set(0,0,0);
                this.cur.p.lerpVectors( newTarget, this.def, t );

                // overwriting newTarget ( aka this._tempV3_0 ). Add curve on the z axis (slightly better visually)
                let extraZSizeFactor = Math.min( 1, newTarget.sub( this.def ).lengthSq() / (this.worldArmSize * this.worldArmSize * 0.5) );
                let extraZsize = this.worldArmSize * 0.3 * extraZSizeFactor; // depending on how far the next objective
                let extra =  2 * extraZsize * t * (1-t); // bezier simplified    [ 0 | size | 0 ]
                this.cur.p.z += extra;
            }
        }

    }


    // all second and main attributes do not get mixed until the end (jasigning)
    _newGestureLocationComposer( bml, symmetry, resultPos, isSecond = false ){
        let location = isSecond ? bml.secondLocationBodyArm : bml.locationBodyArm;

        // Symmetry should be only for sides
        // for symmetry - the left and right must be swapped
        // if ( ( symmetry & 0x01 ) && location ){ 
        //     if ( location[location.length-1] == "L" ){ location = location.slice(0, location.length-1) + "R"; } 
        //     else if( location[location.length-1] == "R" ){ location = location.slice(0, location.length-1) + "L"; } 
        // }
        if ( typeof( location ) != "string" ){ return false; }
        location = location.toUpperCase();

        if ( location == "EAR" || location == "EARLOBE" || location == "CHEEK" || location == "EYE" || location == "EYEBROW" || location == "SHOULDER" ){
            location += this.isLeftHand ? "_LEFT" : "_RIGHT";
        }
       
        let side = isSecond ? bml.secondSide : bml.side;
        if ( stringToDirection( side, this._tempV3_0, symmetry, true ) ){ // accumulate result and do not normalize
            // 0.5 and 1.5 to avoid rounding problems
            if ( this._tempV3_0.x < -1.5 ){ location += "_SideRR"; }
            else if ( this._tempV3_0.x < -0.5 ){ location += "_SideR"; }
            else if ( this._tempV3_0.x > 1.5 ){ location += "_SideLL"; }
            else if ( this._tempV3_0.x > 0.5 ){ location += "_SideL"; }
        }

        
        location = this.bodyLocations[ location ];
        if ( !location ){ return false; }
        location.getWorldPosition( resultPos );

        // TODO: expose distance modes? 
        // distance 
        let distance = isNaN( bml.distance ) ? 0 : bml.distance;
        // distance += 0.05; // hack 
        
        if ( location.direction ){
            let m3 = ( new THREE.Matrix3() ).setFromMatrix4( location.matrixWorld );
            this._tempV3_0.copy( location.direction ).applyMatrix3( m3 ).normalize(); // from bone local space to world space direction 
        }else{
            // use avatar Z axis as distance
            this._tempV3_0.copy( this.config.axes[2] );
            // from mesh space to hips local space direction
            let m3 = ( new THREE.Matrix3() ).setFromMatrix4( this.skeleton.boneInverses[ this.config.boneMap.Hips ] );
            this._tempV3_0.applyMatrix3( m3 );
            // from hips local space to world space direction
            m3.setFromMatrix4( this.skeleton.bones[ this.config.boneMap.Hips ].matrixWorld );
            this._tempV3_0.applyMatrix3( m3 );
            this._tempV3_0.normalize();  
        }
        resultPos.addScaledVector( this._tempV3_0, this.worldArmSize * distance );
        
        return true;
    }
    /**
     * bml info
     * start, attackPeak, relax, end
     * locationBodyArm: string from bodyLocations
     * secondLocationBodyArm: (optional)
     * distance: (optional) [0,1] how far from the body to locate the hand. 0 = touch, 1 = arm extended (distance == arm size). 
     * side: (optional) rr, r, l, ll. If non-existant, defaults to center
     * secondSide: (optional)
     * 
     * displace: 26 directions
     * displaceDistance: metres
     * 
     * elbowRaise: (optional) in degrees. Positive values raise the elbow.
     * 
     * Following attributes describe which part of the hand will try to reach the locationBodyArm location 
     * srcContact: (optional) source contact location in a single variable. Strings must be concatenate as srcFinger + srcLocation + srcSide (whenever each variable is needed)
     * srcFinger: (optional) 1,2,3,4,5
     * srcLocation: (optional) string from handLocations (although no forearm, elbow, upperarm are valid inputs here)
     * srcSide: (optional) ULNAR, RADIAL, PALMAR, BACK. (ulnar == thumb side, radial == pinky side. Since hands are mirrored, this system is better than left/right)
     * keepUpdatingContact: (optional) once peak is reached, the location will be updated only if this is true. Default false
     *                  i.e: set to false; contact tip of index; reach destination. Afterwards, changing index finger state will not modify the location
     *                       set to true; contact tip of index; reach destination. Afterwards, changing index finger state (handshape) will make the location change depending on where the tip of the index is  
     * shift does not use contact locations
     */
    newGestureBML( bml, symmetry = 0x00, lastFrameWorldPosition = null ) {
        this.keepUpdatingContact = !!bml.keepUpdatingContact;
        this.contactUpdateDone = false;

        if ( !this._newGestureLocationComposer( bml, symmetry, this.trg, false ) ){
            console.warn( "Gesture: Location Arm no location found with name \"" + bml.locationBodyArm + "\"" );
            return false;
        };
        if( this._newGestureLocationComposer( bml, symmetry, this.src.p, true ) ){ // use src as temporal buffer
            this.trg.lerp( this.src.p, 0.5 );
        }

        // displacement
        if ( stringToDirection( bml.displace, this._tempV3_0, symmetry, true ) ){
            this._tempV3_0.normalize();
            let sideDist = parseFloat( bml.displaceDistance );
            sideDist = isNaN( sideDist ) ? 0 : sideDist;
            this.trg.x += this._tempV3_0.x * sideDist;
            this.trg.y += this._tempV3_0.y * sideDist;
            this.trg.z += this._tempV3_0.z * sideDist;
        }

        // source: Copy current arm state
        if ( lastFrameWorldPosition ){
            this.src.offset.subVectors( lastFrameWorldPosition, this.cur.p );
            this.src.p.copy( this.cur.p );
        }
        else{
            this.src.offset.copy( this.cur.offset );
            this.src.p.copy( this.cur.p );
        }
        
        // change arm's default pose if necesary
        if ( bml.shift ){
            this.def.copy( this.trg );
        }

        // in case the user selects a specific finger bone as end effector. Not affected by shift
        this.contactFinger = null; 
        let contact = HandConstellation.handLocationComposer( bml, this.handLocations, this.isLeftHand, true, false );
        if( contact ){
            // only hand locations allowed as contact
            if ( contact.name && !contact.name.includes( "ARM" ) && !contact.name.includes( "ELBOW" ) ){ this.contactFinger = contact; }
            // TODO: missing second attributes
        }

        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0;
        this.transition = true;

        return true;
    }   
}



class HandConstellation {
    constructor( boneMap, skeleton, rightHandLocations, leftHandLocations ) {
        this.skeleton = skeleton;
        
        this.boneMap = boneMap;
       
       
        this.time = 0; // current time of transition
        this.start = 0; 
        this.attackPeak = 0;
        this.relax = 0;
        this.end = 0;
        
        this.transition = false;

        // assuming both arms are the same size approximately
        this.worldArmSize = 0;
        let v = new THREE.Vector3();
        let u = v.clone();
        let w = v.clone();
        this.skeleton.bones[ boneMap[ "RArm" ] ].getWorldPosition( v );
        this.skeleton.bones[ boneMap[ "RElbow" ] ].getWorldPosition( u );
        this.skeleton.bones[ boneMap[ "RWrist" ] ].getWorldPosition( w );
        this.worldArmSize = v.sub(u).length() + u.sub(w).length();


        this.handLocationsR = rightHandLocations;
        this.handLocationsL = leftHandLocations;

        this.prevOffsetL = new THREE.Vector3(); // in case a handconstellation enters before the previous one ends. Keep the old current offset
        this.prevOffsetR = new THREE.Vector3();
        this.curOffsetL = new THREE.Vector3(); // wrist position resulting from update
        this.curOffsetR = new THREE.Vector3(); // wrist position resulting form update

        // after reaching peak, user might choose to keep updating with real position or keep the peak value reached 
        this.keepUpdatingContact = false;
        this.peakOffsetL = new THREE.Vector3(0,0,0);
        this.peakOffsetR = new THREE.Vector3(0,0,0);
        this.peakUpdated = false;


        this.srcCurOffset = null; // pointer to curOffset L or R
        this.srcPoints = [null,null];
        this.dstCurOffset = null; // pointer to curOffset L or R
        this.dstPoints = [null,null];

        this.distanceVec = new THREE.Vector3(0,0,0);
        
        this.isBothHands = false; // whether to move only src hand to dst point or move both hands to their respective destination points 
        this.activeArmsFlag = 0x00; // 0x01 source active, 0x02 destination active (if both hands enabled, otherwise only 0x01 should be set)
        // set default poses
        this.reset();

        this._tempV3_0 = new THREE.Vector3();
        this._tempV3_1 = new THREE.Vector3();
        this._tempV3_2 = new THREE.Vector3();
    }

    reset(){
        this.transition = false;
        this.prevOffsetL.set(0,0,0);
        this.prevOffsetR.set(0,0,0);
        this.curOffsetL.set(0,0,0);
        this.curOffsetR.set(0,0,0);
        this.distanceVec.set(0,0,0);
        this.isBothHands = false;
        this.activeArmsFlag = 0x00;

        this.keepUpdatingContact = false;
        this.peakUpdated = false;
        this.peakOffsetL.set(0,0,0);
        this.peakOffsetR.set(0,0,0);
    }

    update( dt ){
        // nothing to do
        if ( !this.transition ){ return; } 

        this.time += dt;

        // wait in same pose
        if ( this.time < this.start ){ 
            return;
        }

        if ( this.keepUpdatingContact || !this.peakUpdated ){ 

            // compute source and target points 
            this.srcPoints[0].updateWorldMatrix( true ); // self and parents
            let srcWorldPoint = this._tempV3_0.setFromMatrixPosition( this.srcPoints[0].matrixWorld );
            if ( this.srcPoints[1] ){
                this.srcPoints[1].updateWorldMatrix( true ); // self and parents
                this._tempV3_2.setFromMatrixPosition( this.srcPoints[1].matrixWorld );  
                srcWorldPoint.lerp( this._tempV3_2, 0.5 );
            }
            this.dstPoints[0].updateWorldMatrix( true ); // self and parents
            let dstWorldPoint = this._tempV3_1.setFromMatrixPosition( this.dstPoints[0].matrixWorld );
            if ( this.dstPoints[1] ){
                this.dstPoints[1].updateWorldMatrix( true ); // self and parents
                this._tempV3_2.setFromMatrixPosition( this.dstPoints[1].matrixWorld );  
                dstWorldPoint.lerp( this._tempV3_2, 0.5 );
            }
            
            // compute offset for each hand
            if ( this.isBothHands ){
                if ( this.activeArmsFlag & 0x01 ){
                    this.srcCurOffset.lerpVectors( srcWorldPoint, dstWorldPoint, 0.5 );
                    this.srcCurOffset.sub( srcWorldPoint );
                    this.srcCurOffset.addScaledVector( this.distanceVec, 0.5 );
                }
                else{ this.srcCurOffset.set(0,0,0); }
                
                if ( this.activeArmsFlag & 0x02 ){
                    this.dstCurOffset.lerpVectors( dstWorldPoint, srcWorldPoint, 0.5 );
                    this.dstCurOffset.sub( dstWorldPoint );
                    this.dstCurOffset.addScaledVector( this.distanceVec, -0.5 ); // same as subScaledVector but this function does not exist
                }
                else{ this.dstCurOffset.set(0,0,0); }
            }else{
                this.srcCurOffset.copy( dstWorldPoint );
                this.srcCurOffset.sub( srcWorldPoint );
                this.srcCurOffset.add( this.distanceVec );
                this.dstCurOffset.set(0,0,0);
            }

            // does not need to keep updating. Set this src and dst as final positions and flag as peak updated
            if ( this.time > this.attackPeak && !this.keepUpdatingContact && !this.peakUpdated ){
                this.peakOffsetL.copy( this.curOffsetL );
                this.peakOffsetR.copy( this.curOffsetR );
                this.peakUpdated = true;
            }
        }

        // reminder: srcCurOffset and dstCurOffset are pointers to curOffsetL and curOffsetR
        // now that final points are computed, interpolate from origin to target
        let t = 0;
        if ( this.time <= this.attackPeak ){
            t = ( this.time - this.start ) / ( this.attackPeak - this.start );
            if ( t > 1){ t = 1; }
            t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;

            this.curOffsetL.lerpVectors( this.prevOffsetL, this.curOffsetL, t );
            this.curOffsetR.lerpVectors( this.prevOffsetR, this.curOffsetR, t );

        }    
        else if ( this.time > this.attackPeak && this.time < this.relax ){ 
            // t = 1;
            // nothing else to update
        }            
        else if ( this.time >= this.relax){
            t = ( this.end - this.time ) / ( this.end - this.relax );
            if ( t > 1 ){ t = 1; }
            if ( t < 0 ){ t = 0; }
            t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;
            
            if ( this.time >= this.end ){ this.transition = false; }

            if ( !this.keepUpdatingContact ){
                this.curOffsetL.copy( this.peakOffsetL );
                this.curOffsetR.copy( this.peakOffsetR );
            }
            this.curOffsetL.multiplyScalar( t );
            this.curOffsetR.multiplyScalar( t );

        }
        
    }

    cancelArm( arm = "R" ){
        if ( arm == "B" ){ this.activeArmsFlag = 0x00 }
        if ( arm == "R"){ 
            this.activeArmsFlag &= ( this.srcCurOffset == this.curOffsetR ) ? (~0x01) : (~0x02); 
            this.prevOffsetR.set(0,0,0); 
            this.curOffsetR.set(0,0,0); 
            this.peakOffsetR.set(0,0,0);
        }
        else if ( arm == "L"){ 
            this.activeArmsFlag &= ( this.srcCurOffset == this.curOffsetL ) ? (~0x01) : (~0x02); 
            this.prevOffsetL.set(0,0,0); 
            this.curOffsetL.set(0,0,0); 
            this.peakOffsetL.set(0,0,0);
        }

        if ( !this.activeArmsFlag ){ this.reset(); }
    }


    static handLocationComposer( bml, handLocations, isLeftHand = false, isSource = true, isSecond = false ){
        // check all-in-one variable first
        let compactContact;
        if ( isSource ){ compactContact = isSecond ? bml.secondSrcContact : bml.srcContact }
        else{ compactContact = isSecond ? bml.secondDstContact : bml.dstContact; }
        if ( typeof( compactContact ) == "string" ){
            compactContact = compactContact.toUpperCase();
            let result = handLocations[ compactContact ];
            if ( result ){ return result; }
        }

        // check decomposed variables
        let finger, side, location;
        if ( isSource ){ 
            if ( isSecond ){ finger = bml.secondSrcFinger; side = bml.secondSrcSide; location = bml.secondSrcLocation; } 
            else{ finger = bml.srcFinger; side = bml.srcSide; location = bml.srcLocation; } 
        }
        else{ 
            if ( isSecond ){ finger = bml.secondDstFinger; side = bml.secondDstSide; location = bml.secondDstLocation; } 
            else{ finger = bml.dstFinger; side = bml.dstSide; location = bml.dstLocation; } 
        }
        finger = parseInt( finger );
                

        if ( isNaN( finger ) || finger < 1 || finger > 5 ){ finger = ""; }
        if ( typeof( location ) != "string" || location.length < 1 ){ location = ""; }
        else{ 
            location = ( finger > 0 ? "_" : "" ) + location.toUpperCase();
        }
        if ( typeof( side ) != "string" || side.length < 1 ){ side = ""; }
        else{ 
            side = side.toUpperCase();
            if ( !location.includes("ELBOW") && !location.includes("UPPER_ARM") ){ // jasigning...
                if ( side == "RIGHT" ){ side = isLeftHand ?  "RADIAL" : "ULNAR" ; }
                else if ( side == "LEFT" ){ side = isLeftHand ? "ULNAR" : "RADIAL"; }
            }
            side = "_" + side;
        }
        let name = finger + location + side; 

        let result = handLocations[ name ];
        // if ( !result ){ result = handLocations[ "2_TIP" ]; }
        return result;
    }
    /**
     * bml info
     * start, attackPeak, relax, end
     * distance: [-ifinity,+ifninity] where 0 is touching and 1 is the arm size. Distance between endpoints. Right now only horizontal distance is applied
     * 
     * Location of the hand in the specified hand (or dominant hand)
     * srcContact: (optional) source contact location in a single variable. Strings must be concatenate as srcFinger + "_" +srcLocation + "_" +srcSide (whenever each variable is needed)
     * srcFinger: (optional) 1,2,3,4,5
     * srcLocation: (optional) string from handLocations (although no forearm, elbow, upperarm are valid inputs here)
     * srcSide: (optional) ULNAR, RADIAL, PALMAR, BACK. (ulnar == thumb side, radial == pinky side. Since hands are mirrored, this system is better than left/right)
     * 
     * Location of the hand in the unspecified hand (or non dominant hand)
     * dstContact: (optional) source contact location in a single variable. Strings must be concatenate as dstFinger + dstLocation + dstSide (whenever each variable is needed)
     * dstFinger: (optional) 1,2,3,4,5
     * dstLocation: (optional) string from handLocations (although no forearm, elbow, upperarm are valid inputs here)
     * dstSide: (optional) ULNAR, RADIAL, PALMAR, BACK 
     * 
     * keepUpdatingContact: (optional) once peak is reached, the location will be updated only if this is true. 
     *                  i.e: set to false; contact tip of index; reach destination. Afterwards, changing index finger state will not modify the location
     *                       set to true; contact tip of index; reach destination. Afterwards, changing index finger state (handshape) will make the location change depending on where the tip of the index is  

     */
    newGestureBML( bml, domHand = "R"  ) {
        this.keepUpdatingContact = !!bml.keepUpdatingContact;
        this.peakUpdated = false;
        let srcLocations = null;
        let dstLocations = null;
        let isLeftHandSource = false; // default right

        if ( bml.hand == "BOTH" ){ // src default to domhand
            this.isBothHands = true;
            this.activeArmsFlag = 0x03; // both source and destination arms are activated
            isLeftHandSource = domHand == "L";
        }else{
            this.isBothHands = false;
            this.activeArmsFlag = 0x01; // only source is activated
            if ( bml.hand == "RIGHT" ){ isLeftHandSource = false; }
            else if ( bml.hand == "LEFT" ){ isLeftHandSource = true; }
            else if ( bml.hand == "NON_DOMINANT" ){ isLeftHandSource = domHand == "R"; }
            else{ isLeftHandSource = domHand == "L"; }
        }

        // save current state as previous state. curOffset changes on each update
        this.prevOffsetL.copy( this.curOffsetL );
        this.prevOffsetR.copy( this.curOffsetR );


        // set pointers
        if ( isLeftHandSource ){
            this.srcCurOffset = this.curOffsetL;
            this.dstCurOffset = this.curOffsetR;
            srcLocations = this.handLocationsL; 
            dstLocations = this.handLocationsR;
        }else{
            this.srcCurOffset = this.curOffsetR;
            this.dstCurOffset = this.curOffsetL;
            srcLocations = this.handLocationsR;
            dstLocations = this.handLocationsL
        }
        this.srcPoints[0] = HandConstellation.handLocationComposer( bml, srcLocations, isLeftHandSource, true, false );
        this.srcPoints[1] = HandConstellation.handLocationComposer( bml, srcLocations, isLeftHandSource, true, true );
        this.dstPoints[0] = HandConstellation.handLocationComposer( bml, dstLocations, !isLeftHandSource, false, false ); 
        this.dstPoints[1] = HandConstellation.handLocationComposer( bml, dstLocations, !isLeftHandSource, false, true );
        if ( !this.srcPoints[0] ){ this.srcPoints[0] = srcLocations[ "2_TIP" ]; }
        if ( !this.dstPoints[0] ){ this.dstPoints[0] = dstLocations[ "2_TIP" ]; }
        
        let distance = parseFloat( bml.distance );
        if ( isNaN( distance ) ){ this.distanceVec.set(0,0,0); }
        else{ 
            if ( !stringToDirection( bml.distanceDirection, this.distanceVec, 0x00, true) ){
                if ( this.srcCurOffset == this.curOffsetR ){ this.distanceVec.set( -1,0,0 ); }
                else{ this.distanceVec.set( 1,0,0 ); }
            }
            this.distanceVec.normalize();
            this.distanceVec.multiplyScalar( distance * this.worldArmSize );
        }

        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0;
        this.transition = true;

        return true;
    }   
}



let _tempVec3_0 = new THREE.Vector3(0,0,0);
let _tempVec3_1 = new THREE.Vector3(0,0,0);
let _tempQuat_0 = new THREE.Quaternion(0,0,0,1);
let _tempQuat_1 = new THREE.Quaternion(0,0,0,1);

class DirectedMotion {
    constructor(){
        this.finalOffset = new THREE.Vector3(0,0,0);        
        this.bezier = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ]

        this.distance = 0.05; // metres
        this.curveSize = 0.5; // [0,1] curve curveSize

        this.zigzagDir = new THREE.Vector3(0,0,1);
        this.zigzagSize = 0.01; // metres. Complete amplitude. Motion will move half to dir and half to -dir
        this.zigzagSpeed = 2; // loops per second

        this.transition = false;
        this.time = 0;

        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0;
        this.end = 0;
    }

    reset(){
        this.transition = false;
        this.finalOffset.set(0,0,0);
    }

    update( dt ){
        if ( !this.transition ){ return; }
        
        this.time += dt;
        if ( this.time < this.start ){ return this.finalOffset; }

        else if ( this.time < this.attackPeak ){
            let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
            // t = Math.sin( Math.PI * t - Math.PI * 0.5 ) * 0.5 + 0.5; // commented because of sigml purposes
            cubicBezierVec3( this.bezier[0], this.bezier[1], this.bezier[2], this.bezier[3], this.finalOffset, t );

            let zigzagAttenuation = Math.min( 1,  Math.min( ( this.attackPeak - this.time ) / 0.15, ( this.time - this.start ) / 0.15 ) );  // min( full, outro, intro ). 0.15 seconds of intro and 0.5 of outro if possible
            let zigzagt = Math.sin( Math.PI * 2 * this.zigzagSpeed * ( this.time - this.start ) ) * this.zigzagSize * 0.5 * zigzagAttenuation;
            this.finalOffset.x = this.finalOffset.x + this.zigzagDir.x * zigzagt;
            this.finalOffset.y = this.finalOffset.y + this.zigzagDir.y * zigzagt;
            this.finalOffset.z = this.finalOffset.z + this.zigzagDir.z * zigzagt;
        }

        else if ( this.time < this.relax ){ 
            this.finalOffset.copy( this.bezier[3] );
        }

        else if ( this.time < this.end ){ // lerp to origin (0,0,0) 
            let t = ( this.time - this.relax ) / ( this.end - this.relax );
            // t = Math.sin( Math.PI * t - Math.PI * 0.5 ) * 0.5 + 0.5; // commented because of sigml purposes
            this.finalOffset.copy( this.bezier[3] );
            this.finalOffset.multiplyScalar( 1.0 - t );
        }

        else { this.transition = false; this.finalOffset.set(0,0,0); }

        return this.finalOffset;
    }

    /**
     * bml info
     * start, attackPeak, relax, end
     * direction: string from 26 directions
     * secondDirection: (optional)
     * distance: (optional) size in metres of the displacement. Default 0.2 m (20 cm)
     * curve: (optional) string from 6 basic directions. Default to none
     * secondCurve: (optional)
     * curveSize: (optional) number from [0,1] meaning the amplitude of the curve
     * zigzag: (optional) string from 26 directions
     * zigzagSize: (optional) amplitude of zigzag (from highest to lowest point) in metres. Default 0.01 m (1 cm)
     * zigzagSpeed: (optional) cycles per second. Default 2
     */
    newGestureBML( bml, symmetry ){
        this.finalOffset.set(0,0,0);
          
        this.distance = isNaN( bml.distance ) ? 0.2 : bml.distance; // metres
        this.curveSize = isNaN( bml.curveSize ) ? 0.5 : Math.max( 0, Math.min( 1, bml.curveSize ) );
        
        // THE FOLLOWING CODE TRIES TO MIMIC JASIGNING/HAMNOSYS BEHAVIOUR. IT COULD BE MUCH SIMPLER OTHERWISE

        // fetch curve direction and adjust curveSize if not present
        let curveDir = _tempVec3_0.set(0,0,0);
        if ( stringToDirection( bml.curve, curveDir, symmetry, true ) ){
            curveDir.z = 0;
            if ( stringToDirection( bml.secondCurve, _tempVec3_1, symmetry, true ) ){
                _tempVec3_1.z = 0;
                curveDir.lerp( _tempVec3_1, 0.5 );
            }
            if ( curveDir.lengthSq() > 0.00001 ){ curveDir.normalize(); }
        }
        curveDir.multiplyScalar( this.curveSize * 0.5 );

        // set default direction (+z), default curve direction (+y) and ajust with size and curve curveSize       
        this.bezier[0].set( 0, 0, 0 );
        this.bezier[1].set( curveDir.x, curveDir.y, 0 );
        this.bezier[2].set( curveDir.x, curveDir.y, this.distance );
        this.bezier[3].set( 0, 0, this.distance );
         
        // fetch direction and secondDirection
        let finalDir = _tempVec3_0;
        if ( !stringToDirection( bml.direction, finalDir, symmetry, true ) ){
            console.warn( "DirectedMotion has incorrect direction values" );
            return false;
        }
        if( finalDir.lengthSq() > 0.0001 ){ finalDir.normalize(); }
        if ( stringToDirection( bml.secondDirection, _tempVec3_1, symmetry, true ) ){
            if( _tempVec3_1.lengthSq() > 0.0001 ){ _tempVec3_1.normalize(); }
            finalDir.lerp( _tempVec3_1, 0.5 );
            if( finalDir.lengthSq() > 0.0001 ){ finalDir.normalize(); }
        }

        // default looks at +z. If direction falls in -z, change default to -z to avoid accidental left-right, up-down mirror
        if ( finalDir.z < 0 ){
            this.bezier[0].z *= -1;
            this.bezier[1].z *= -1;
            this.bezier[2].z *= -1;
            this.bezier[3].z *= -1;
        }
        
        // rotate default direction to match the user's one
        let lookAtQuat = _tempQuat_0;
        if ( Math.abs(finalDir.dot(this.bezier[3])) > 0.999 ){ lookAtQuat.set(0,0,0,1); }
        else{ 
            let angle = finalDir.angleTo( this.bezier[3] );
            _tempVec3_0.crossVectors( this.bezier[3], finalDir );
            _tempVec3_0.normalize();
            lookAtQuat.setFromAxisAngle( _tempVec3_0, angle );
        }
        this.bezier[0].applyQuaternion( lookAtQuat );
        this.bezier[1].applyQuaternion( lookAtQuat );
        this.bezier[2].applyQuaternion( lookAtQuat );
        this.bezier[3].applyQuaternion( lookAtQuat );

        // zig-zag
        if ( stringToDirection( bml.zigzag, this.zigzagDir ) ){
            this.zigzagSize = isNaN( bml.zigzagSize ) ? 0.01 : bml.zigzagSize; // metres
            this.zigzagSpeed = isNaN( bml.zigzagSpeed ) ? 2 : bml.zigzagSpeed; // rps
        }else{
            this.zigzagDir.set(0,0,0);
            this.zigzagSize = 0.0; // metres
            this.zigzagSpeed = 0; // rps
        }

        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0; 

        // flag to start 
        this.transition = true;

        return true;
    }
}

class CircularMotion {
    constructor(){
        this.yAxis = new THREE.Vector3(0,1,0);
        this.xAxis = new THREE.Vector3(1,0,0);
        this.startPoint = new THREE.Vector3(0,0,0);
        this.trgAngle = 0; // target delta angle
        this.srcAngle = 0; 

        this.finalOffset = new THREE.Vector3(0,0,0);
        
        this.zigzagDir = new THREE.Vector3(0,0,1);
        this.zigzagSize = 0.01; // metres. Complete amplitude. Motion will move half to dir and half to -dir
        this.zigzagSpeed = 2; // loops per second

        this.transition = false;
        this.time = 0;

        this.start = 0;
        this.end = 0;
    }

    reset(){
        this.transition = false;
        this.finalOffset.set(0,0,0);
    }

    update( dt ){
        if ( !this.transition ){ return this.finalOffset; }
        
        this.time += dt;
        if ( this.time < this.start ){ return this.finalOffset; }
        if ( this.time >= this.attackPeak && this.time <= this.relax ){ // necessary to update (at least once) or there might be a jump
            this.finalOffset.set(0,0,0);
            this.finalOffset.addScaledVector( this.xAxis, Math.cos( this.trgAngle ) );
            this.finalOffset.addScaledVector( this.yAxis, Math.sin( this.trgAngle ) );
            this.finalOffset.sub( this.startPoint );
            return this.finalOffset; 
        }
        if ( this.time >= this.relax && this.time <= this.end ){ 
            this.finalOffset.set(0,0,0);
            this.finalOffset.addScaledVector( this.xAxis, Math.cos( this.trgAngle ) );
            this.finalOffset.addScaledVector( this.yAxis, Math.sin( this.trgAngle ) );
            this.finalOffset.sub( this.startPoint );
            this.finalOffset.multiplyScalar( ( this.end - this.time ) / ( this.end - this.relax ) );
            return this.finalOffset;
        }
        if ( this.time >= this.end ){ 
            this.transition = false; 
            this.finalOffset.set(0,0,0); 
            return this.finalOffset;
        }

        //if ( time > start && time < attackpeak ) start attackpeak
        let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
        // t = Math.sin( Math.PI * t - Math.PI * 0.5 ) * 0.5 + 0.5;  // commented because of sigml purposes
        t = ( t > 1 ) ? 1 : t;
        
        // angle to rotate startPoint
        this.finalOffset.set(0,0,0);
        this.finalOffset.addScaledVector( this.xAxis, Math.cos( this.srcAngle * ( 1 - t ) + this.trgAngle * t ) );
        this.finalOffset.addScaledVector( this.yAxis, Math.sin( this.srcAngle * ( 1 - t ) + this.trgAngle * t ) );
        this.finalOffset.sub( this.startPoint );

        // zigzag 
        if ( Math.abs(this.zigzagSize) > 0.0001 ){
            let easing = Math.max( 0, Math.min( 1, Math.min( ( this.time - this.start ) / 0.5, ( this.attackPeak - this.time ) / 0.5 ) ) );
            let zigzagt = Math.sin( Math.PI * 2 * this.zigzagSpeed * ( this.time - this.start ) ) * this.zigzagSize * 0.5 * easing;
            this.finalOffset.x = this.finalOffset.x + this.zigzagDir.x * zigzagt;
            this.finalOffset.y = this.finalOffset.y + this.zigzagDir.y * zigzagt;
            this.finalOffset.z = this.finalOffset.z + this.zigzagDir.z * zigzagt;
        }
        return this.finalOffset;
    }

    /**
     * bml info
     * start, attackPeak, relax, end
     * direction: string from 26 directions. Axis of rotation
     * secondDirection: (optional)
     * distance: (optional) radius in metres of the circle.  Default 0.05 m (5 cm)
     * startAngle: (optional) where in the circle to start. 0º indicates up. Indicated in degrees. Default to 0º. [-infinity, +infinity]
     * endAngle: (optional) where in the circle to finish. 0º indicates up. Indicated in degrees. Default to 360º. [-infinity, +infinity]
     * ellipseAxisDirection: (optional) string from u,d,l,r directions (i,o are ignored).
     * ellipseAxisRatio: (optional) number in range [0,1]. Indicates the axis ratio of the ellipse ( minor / major ). Default to 1 (circle)
     * zigzag: (optional) string from 26 directions
     * zigzagSize: (optional) amplitude of zigzag (from highest to lowest point) in metres. Default 0.01 m (1 cm)
     * zigzagSpeed: (optional) cycles per second. Default 2
     */
    newGestureBML( bml, symmetry ){
        this.finalOffset.set(0,0,0);
        
        // assume normal axis = (0,0,1). Set the ellipse shape 2D (x,y)
        let distance = isNaN( bml.distance ) ? 0.05 : bml.distance;
        let axisRatio = parseFloat( bml.ellipseAxisRatio ); // minor / major
        if ( isNaN( axisRatio ) ){ axisRatio = 1; } // basically a circle

        if ( stringToDirection( bml.ellipseAxisDirection, _tempVec3_0, symmetry, true ) ){
            _tempVec3_0.z = 0;
            if ( _tempVec3_0.lengthSq() < 0.0001 ){ _tempVec3_0.set(1,0,0); }
            else{ _tempVec3_0.normalize(); }
        }else{
            _tempVec3_0.set(1,0,0);
        }
        this.xAxis.copy( _tempVec3_0 ).multiplyScalar( distance ); // set major axis
        this.yAxis.set( -this.xAxis.y, this.xAxis.x, 0 ).multiplyScalar( axisRatio ); // set minor axis

        // normal axis
        if ( !stringToDirection( bml.direction, _tempVec3_0, symmetry, true ) ){
            console.warn( "Gesture: Location Motion no direction found with name \"" + bml.direction + "\"" );
            return false;
        }
        if ( !stringToDirection( bml.secondDirection, _tempVec3_1, symmetry, true ) ){
            _tempVec3_1.copy( _tempVec3_0 );
        }
        _tempVec3_1.lerpVectors( _tempVec3_1, _tempVec3_0, 0.5 );
        if( _tempVec3_1.lengthSq() < 0.0001 ){ _tempVec3_1.copy( _tempVec3_0 ); }
        _tempVec3_1.normalize(); // final axis perpendicular to circle

        // reorient ellipse normal from (0,0,1) to whatever axis the user specified
        let elevation = Math.asin( _tempVec3_1.y );
        let bearing = Math.atan2( _tempVec3_1.x, _tempVec3_1.z );
        _tempQuat_0.setFromAxisAngle( _tempVec3_0.set(1,0,0), -elevation );
        _tempQuat_1.setFromAxisAngle( _tempVec3_0.set(0,1,0), bearing );
        _tempQuat_0.premultiply( _tempQuat_1 );
        this.xAxis.applyQuaternion( _tempQuat_0 );
        this.yAxis.applyQuaternion( _tempQuat_0 );
        
        // angle computations
        this.srcAngle = isNaN( bml.startAngle ) ? 0 : ( bml.startAngle * Math.PI / 180.0 );
        this.trgAngle = isNaN( bml.endAngle ) ? ( this.srcAngle + 2 * Math.PI ) : ( bml.endAngle * Math.PI / 180.0 );
        if( symmetry ){ // all symmetries mirror the same
            this.trgAngle *= -1;
            this.srcAngle *= -1;
        }
       
        this.startPoint.set(0,0,0);
        this.startPoint.addScaledVector( this.xAxis, Math.cos( this.srcAngle ) );
        this.startPoint.addScaledVector( this.yAxis, Math.sin( this.srcAngle ) );

        // zig-zag
        if ( stringToDirection( bml.zigzag, this.zigzagDir ) ){
            this.zigzagSize = isNaN( bml.zigzagSize ) ? 0.01 : bml.zigzagSize; // metres
            this.zigzagSpeed = isNaN( bml.zigzagSpeed ) ? 2 : bml.zigzagSpeed; // rps
        }else{
            this.zigzagDir.set(0,0,0);
            this.zigzagSize = 0.0; // metres
            this.zigzagSpeed = 0; // rps
        }

        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0; 

        // flag to start 
        this.transition = true;
        
        return true;
    }
}

class FingerPlay {
    constructor(){ 
        this.curBends = [ 0, 0, 0, 0, 0 ]; // thumb, index, middle, ring, pinky
        this.fingerEnabler = 0x00; // flags. bit0 = thumb, bit1 = index, bit2 = middle, bit3 = ring, bit4 = pinky
        
        this.transition = false;
        this.speed = 3;
        this.intensity = 0.3;
        
        
        this.clock = 0; // using cos operations. if a fingerplay overwrites another in play, need to be in the same phase  
        this.curUpdateIntensity = [0,0,0,0,0];
        this.srcUpdateIntensity = [0,0,0,0,0];
        
        this.time = 0;
        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0;
        this.end = 0;
    }

    reset(){
        this.transition = false;
        this.curBends.fill( 0 );
    }

    update( dt ){
        if ( !this.transition ){ return; }

        this.clock += dt;
        this.time += dt;
        let interpolator = 0;
        let introInterpolator = 1;
        if ( this.time < this.start ){ introInterpolator= 0; interpolator = 0; }
        else if ( this.time < this.attackPeak ){ 
            interpolator = ( this.time - this.start ) / ( this.attackPeak - this.start ); 
            introInterpolator = interpolator;
        }
        else if ( this.time < this.relax ){ interpolator = 1; }
        else if ( this.time < this.end ){ interpolator = ( this.end - this.time ) / ( this.end - this.relax ); }
        else {
            interpolator = 0; 
            this.transition = false;
        }

        let intensity = interpolator * this.intensity;

        // interpolation -- cos(t + X) where X is different for each finger
        this.curUpdateIntensity[0] = ( (this.fingerEnabler & 0x01 ? 1 : 0) * intensity ) + this.srcUpdateIntensity[0] * (1-introInterpolator);
        this.curBends[0] = ( Math.cos( Math.PI * 2 * this.speed * this.clock + Math.PI * 0.25 ) * 0.5 + 0.5 ) * this.curUpdateIntensity[0];

        this.curUpdateIntensity[1] = ( (this.fingerEnabler & 0x02 ? 1 : 0) * intensity ) + this.srcUpdateIntensity[1] * (1-introInterpolator);
        this.curBends[1] = ( Math.cos( Math.PI * 2 * this.speed * this.clock ) * 0.5 + 0.5 ) * this.curUpdateIntensity[1];

        this.curUpdateIntensity[2] = ( (this.fingerEnabler & 0x04 ? 1 : 0) * intensity ) + this.srcUpdateIntensity[2] * (1-introInterpolator);
        this.curBends[2] = ( Math.cos( Math.PI * 2 * this.speed * this.clock + Math.PI * 0.65 ) * 0.5 + 0.5 ) * this.curUpdateIntensity[2];

        this.curUpdateIntensity[3] = ( (this.fingerEnabler & 0x08 ? 1 : 0) * intensity ) + this.srcUpdateIntensity[3] * (1-introInterpolator); 
        this.curBends[3] = ( Math.cos( Math.PI * 2 * this.speed * this.clock + Math.PI * 1.05 ) * 0.5 + 0.5 ) * this.curUpdateIntensity[3];

        this.curUpdateIntensity[4] = ( (this.fingerEnabler & 0x10 ? 1 : 0) * intensity ) + this.srcUpdateIntensity[4] * (1-introInterpolator);
        this.curBends[4] =  ( Math.cos( Math.PI * 2 * this.speed * this.clock + Math.PI * 1.35 ) * 0.5 + 0.5 ) * this.curUpdateIntensity[4];
    }

     /**
     * bml info
     * start, attackPeak, relax, end
     * speed = (optional) oscillations per second. Default 3
     * intensity = (optional) [0,1]. Default 0.3
     * fingers = (optional) string with numbers. Each number present activates a finger. 1=thumb, 2=index, 3=middle, 4=ring, 5=pinky. I.E. "234" activates index, middle, ring but not pinky. Default all enabled
     * exemptedFingers = (optional) string with numbers. Blocks a finger from doing the finger play. Default all fingers move
     */
    newGestureBML( bml ){
        
        this.transition = true;
        this.speed = isNaN( bml.speed ) ? 3 : bml.speed;
        this.intensity = isNaN( bml.intensity ) ? 0.3 : bml.intensity;
        this.intensity = Math.min( 1, Math.max( -1, this.intensity ) ) * 0.5;

        // swap pointers
        let temp = this.srcUpdateIntensity; 
        this.srcUpdateIntensity = this.curUpdateIntensity;
        this.curUpdateIntensity = temp;

        this.fingerEnabler = 0x1f;
        if ( typeof( bml.fingers ) == 'string' ){
            // enable only the specified fingers (bits)
            this.fingerEnabler = 0x00; 
            for( let i = 0; i < bml.fingers.length; ++i ){
                let val = parseInt( bml.fingers[i] );
                if ( !isNaN( val ) ){ this.fingerEnabler |= 0x01 << (val-1); }
            }
            this.fingerEnabler &= 0x1f; // mask unused bits
        }
        if ( typeof( bml.exemptedFingers ) == 'string' ){
            // enable only the specified fingers (bits)
            for( let i = 0; i < bml.exemptedFingers.length; ++i ){
                let val = parseInt( bml.exemptedFingers[i] );
                if ( !isNaN( val ) ){ this.fingerEnabler &= ~(0x01 << (val-1)); }
            }
            this.fingerEnabler &= 0x1f; // mask unused bits
        }


        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0;

        return true;
    }

};



class WristMotion {
    constructor( config, skeleton, isLeftHand = false ){
        this.skeleton = skeleton;
        this.config = config;
        
        this.time = 0;
        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0;
        this.end = 0;
        this.transition = false;

        this.clock = 0; // using cos operations. if a wristmotion overwrites another in play, need to be in the same phase  
        this.curUpdateIntensity = [0,0,0]; // [ twist, nod, swing ]
        this.srcUpdateIntensity = [0,0,0];
        
        this.mode = 0; // FLAGS 0=NONE, 1=TWIST, 2=NOD, 4=SWING 
        this.intensity = 1;
        this.speed = 1;
        
        let handName = isLeftHand ? "L" : "R";
        this.wristBone = this.skeleton.bones[ config.boneMap[ handName + "Wrist" ] ];
        
        // ** compute axes based on skeleton T-pose shape. Avoids hardcoded axes **
        this.axes = [ new THREE.Vector3(0,0,1), new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0) ]; // twist, nod, swing. Axes in local space
        let wristBindMat = this.skeleton.boneInverses[ config.boneMap[ handName + "Wrist" ] ];
        let middleBindMat = this.skeleton.boneInverses[ config.boneMap[ handName + "HandMiddle" ] ];
        let indexBindMat = this.skeleton.boneInverses[ config.boneMap[ handName + "HandIndex" ] ];
        let ringBindMat = this.skeleton.boneInverses[ config.boneMap[ handName + "HandRing" ] ];
        
        // bind world positions
        let wristBindPos = (new THREE.Vector3()).setFromMatrixPosition( wristBindMat.clone().invert() );
        let middleBindDir = (new THREE.Vector3()).setFromMatrixPosition( middleBindMat.clone().invert() ).sub( wristBindPos ).normalize();
        let indexBindDir = (new THREE.Vector3()).setFromMatrixPosition( indexBindMat.clone().invert() ).sub( wristBindPos ).normalize();
        let ringBindDir = (new THREE.Vector3()).setFromMatrixPosition( ringBindMat.clone().invert() ).sub( wristBindPos ).normalize();

        this.axes[0].copy( middleBindDir ); // twist
        this.axes[2].crossVectors( ringBindDir, indexBindDir ).multiplyScalar( isLeftHand ? -1 : 1 ).normalize(); // temporal swing
        this.axes[1].crossVectors( this.axes[2], this.axes[0] ).normalize(); // nod
        this.axes[2].crossVectors( this.axes[0], this.axes[1] ); // ensure swing axis is perpendicular

        let wristBindWtoL = (new THREE.Matrix3()).setFromMatrix4( wristBindMat ); // just for direction vectors
        this.axes[0].applyMatrix3( wristBindWtoL ).normalize();
        this.axes[1].applyMatrix3( wristBindWtoL ).normalize();
        this.axes[2].applyMatrix3( wristBindWtoL ).normalize();
        
    }

    reset(){
        this.time = 0;
        this.mode = 0;
        this.transition = false;
    }

    update( dt ){
        if ( !this.transition ){ return; }

        this.clock += dt;
        this.time += dt;
        let interpolator = 0;
        let introInterpolator = 0;
        if ( this.time < this.start ){ interpolator = 0; }
        else if ( this.time < this.attackPeak ){ interpolator = ( this.time - this.start ) / ( this.attackPeak - this.start ); introInterpolator = 1.0-interpolator; }
        else if ( this.time < this.relax ){ interpolator = 1; }
        else if ( this.time < this.end ){ interpolator = ( this.end - this.time ) / ( this.end - this.relax ); }
        else {
            interpolator = 0; 
            this.mode = 0x00;
            this.transition = false;
        }
        
        let intensity = 0;
        let axis = _tempVec3_0;

        // TWIST
        axis.copy( this.axes[0] ).applyQuaternion( this.wristBone.quaternion ); // apply other rotations to ensure correct axis direction
        intensity = this.srcUpdateIntensity[0] * introInterpolator;
        if ( this.mode & 0x01 ){ intensity += this.intensity * interpolator };
        this.curUpdateIntensity[0] = intensity;
        _tempQuat_0.setFromAxisAngle( axis, Math.cos( 2 * Math.PI * this.speed * this.clock ) * intensity * ( Math.PI * 0.5 ) );
        this.wristBone.quaternion.premultiply( _tempQuat_0 );

        // NOD
        axis.copy( this.axes[1] ).applyQuaternion( this.wristBone.quaternion ); // apply other rotations to ensure correct axis direction
        intensity = this.srcUpdateIntensity[1] * introInterpolator;
        if ( this.mode & 0x02 ){ intensity += this.intensity * interpolator };
        this.curUpdateIntensity[1] = intensity;
        _tempQuat_0.setFromAxisAngle( axis, Math.cos( 2 * Math.PI * this.speed * this.clock ) * intensity * ( Math.PI * 0.5 ) );
        this.wristBone.quaternion.premultiply( _tempQuat_0 );
        
        // SWING
        axis.copy( this.axes[2] ).applyQuaternion( this.wristBone.quaternion ); // apply other rotations to ensure correct axis direction
        intensity = this.srcUpdateIntensity[2] * introInterpolator;
        if ( this.mode & 0x04 ){ intensity += this.intensity * interpolator };
        this.curUpdateIntensity[2] = intensity;
        _tempQuat_0.setFromAxisAngle( axis, Math.sin( 2 * Math.PI * this.speed * this.clock ) * intensity * ( Math.PI * 0.5 ) ); // PHASE of 90ª (sin instead of cos) with respect to NOD (see newGestureBML)
        this.wristBone.quaternion.premultiply( _tempQuat_0 );
    }

     /**
     * bml info
     * start, attackPeak, relax, end
     * mode = either a: 
     *          - string from [ "NOD", "NODDING", "SWING", "SWINGING", "TWIST", "TWISTING", "STIR_CW", "STIR_CCW", "ALL" ]
     *          - or a value from [ 0 = None, 1 = TWIST, 2 = NOD, SWING = 4 ]. 
     *            Several values can co-occur by using the OR (|) operator. I.E. ( 2 | 4 ) = STIR_CW
     *            Several values can co-occur by summing the values. I.E. ( 2 + 4 ) = STIR_CW
     * speed = (optional) oscillations per second. A negative values accepted. Default 3. 
     * intensity = (optional) [0,1]. Default 0.3
     */
    newGestureBML( bml, symmetry ){
        
        this.speed = isNaN( bml.speed ) ? 3 : bml.speed;
        if ( symmetry & 0x07 ){ this.speed *= -1; }
        this.intensity = isNaN( bml.intensity ) ? 0.3 : bml.intensity;
        this.intensity = Math.min( 1, Math.max( 0, this.intensity ) );
        
        if ( typeof( bml.mode ) == "string" ){
            switch( bml.mode.toLowerCase() ){
                case "nod": case "nodding": this.mode = 0x02; break;
                case "swing": case "swinging": this.mode = 0x04; break;
                case "twist": case "twisting": this.mode = 0x01; break;
                case "stir_cw": this.mode = 0x06; break; // 0x02 | 0x04
                case "stir_ccw": this.mode = 0x06; this.speed *= -1; break;
                case "all": this.mode = 0x07; break;
                default:
                    console.warn( "Gesture: No wrist motion called \"", bml.mode, "\" found" );
                    return false;
            }
        }
        else if ( isNaN( bml.mode ) ) {
            console.warn( "Gesture: No wrist motion called \"", bml.mode, "\" found" );
            return false;
        }
        else{
            this.mode = bml.mode & 0x07; // take only the necessary bits
        }

        // swap pointers
        let temp = this.curUpdateIntensity;
        this.curUpdateIntensity = this.srcUpdateIntensity;
        this.srcUpdateIntensity = temp;
        
        // check and set timings
        this.start = bml.start;
        this.attackPeak = bml.attackPeak;
        this.relax = bml.relax;
        this.end = bml.end;
        this.time = 0; 

        this.transition = true;
        
        return true;
    }
};
    

class BasicBMLValueInterpolator {
    constructor( config, skeleton, isLeftHand = false ){
        this.skeleton = skeleton;
        this.isLeftHand = !!isLeftHand;
        this.config = config;

        // store TWIST quaternions for forearm and hand (visally better than just forearm or wrist)
        this.defValue = 0;
        this.trgValue = 0;
        this.srcValue = 0;
        this.curValue = 0;

        this.time = 0; // current time of transition
        this.start = 0;
        this.attackPeak = 0;
        this.relax = 0; 
        this.end = 0;
        this.transition = false;
        
        // set default pose
        this.reset();
    }

    reset() {
        // Force pose update to flat
        this.transition = false;
        this.defValue = 0;
        this.curValue = 0;
    }

    update( dt ) {
        if ( !this.transition ){ return; } // no animation required
        
        this.time += dt;
        // wait in same pose
        if ( this.time < this.start ){ return; }
        if ( this.time > this.attackPeak && this.time < this.relax ){ 
            this.curValue = this.trgValue;
            return; 
        }
        
        if ( this.time <= this.attackPeak ){
            let t = ( this.time - this.start ) / ( this.attackPeak - this.start );
            if ( t > 1 ){ t = 1; }
            t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;
            this.curValue = this.srcValue * ( 1 - t ) + this.trgValue * t;
            return;
        }

        if ( this.time >= this.relax ){
            let t = ( this.time - this.relax ) / ( this.end - this.relax );
            if ( t > 1 ){ t = 1; }
            t = Math.sin(Math.PI * t - Math.PI * 0.5) * 0.5 + 0.5;
            this.curValue = this.trgValue * ( 1 - t ) + this.defValue * t;

            if ( this.time > this.end ){ 
                this.transition = false;
            }
        }
        

    }


    /**
     * bml info
     * start, attackPeak, relax, end
     */
    newGestureBML( newTargetValue, start, attackPeak, relax, end, shift = false ){
        if( isNaN( newTargetValue ) || newTargetValue == null ){ return false; }

        // set source pose twist quaternions
        this.srcValue = this.curValue; 

        // set target pose
        this.trgValue = newTargetValue;

        // set defualt pose if necessary
        if ( shift ){
            this.defValue = this.trgValue;
        }

        // check and set timings
        this.start = start;
        this.attackPeak = attackPeak;
        this.relax = relax;
        this.end = end;
        this.time = 0; 
        
        this.transition = true;

        return true;
    }
}

class ElbowRaise extends BasicBMLValueInterpolator {
    newGestureBML ( bml ){
        let value = parseFloat( bml.elbowRaise ) * ( 90 * Math.PI / 180 ); // shoulderRaise = [0,1]. where 1 == 90 Degrees
        return super.newGestureBML( value, bml.start, bml.attackPeak, bml.relax, bml.end, bml.shift );
    }
}

class ShoulderRaise extends BasicBMLValueInterpolator {
    newGestureBML ( bml ){
        let value =  parseFloat( bml.shoulderRaise ) * ( 30 * Math.PI / 180 ); // shoulderRaise = [0,1]. where 1 == 30 Degrees
        return super.newGestureBML( value, bml.start, bml.attackPeak, bml.relax, bml.end, bml.shift );
    }
}

class ShoulderHunch extends BasicBMLValueInterpolator {
    newGestureBML ( bml ){
        let value = parseFloat( bml.shoulderHunch ) * ( 30 * Math.PI / 180 ); // shoulderRaise = [0,1]. where 1 == 30 Degrees
        return super.newGestureBML( value, bml.start, bml.attackPeak, bml.relax, bml.end, bml.shift );
    }
}

// this class should be different, but need to support jasigning
class BodyMovement {
    constructor ( config, skeleton ){
        this.config = config;
        this.skeleton = skeleton;

        // this should not be like this, but because of jasigning, create and destroy BasicBMLValueInterpolators and stack update results on each BodyMovement.update
        this.tiltFB = [];
        this.tiltLR = [];
        this.rotateLR = [];

        this.transition = false;

        this._tempQ_0 = new THREE.Quaternion();
        
        this.jointsData = { };
        this.jointsData.shouldersUnion = this.computeJointData( this.config.boneMap.ShouldersUnion, this.config.boneMap.Neck );
        this.jointsData.stomach = this.computeJointData( this.config.boneMap.Stomach, this.config.boneMap.ShouldersUnion );
        this.jointsData.belowStomach = this.computeJointData( this.config.boneMap.BelowStomach, this.config.boneMap.Stomach );
    }

    computeJointData( boneIdx, upAxisReferenceBoneIdx ){
        let bindQuat = (new THREE.Quaternion());
        getBindQuaternion( this.skeleton, boneIdx, bindQuat );

        // compute local axes of rotation based on bones boneIdx and upAxisReferenceBoneIdx.
        let xAxis = new THREE.Vector3();
        let yAxis = new THREE.Vector3();
        let zAxis = new THREE.Vector3();
        zAxis.setFromMatrixPosition( this.skeleton.boneInverses[ boneIdx ].clone().invert() ); // position of boneIdx in mesh coordinates
        yAxis.setFromMatrixPosition( this.skeleton.boneInverses[ upAxisReferenceBoneIdx ].clone().invert() ); // position of upAxisReferenceBoneIdx in mesh coordinates
        yAxis.subVectors( yAxis, zAxis ); // Y axis direction in mesh coordinates
        let m3 = (new THREE.Matrix3).setFromMatrix4( this.skeleton.boneInverses[ boneIdx ] ); // mesh to local, directions only
        yAxis.applyMatrix3( m3 ).normalize(); // Y axis, convert to local boneIdx coordinates
        zAxis.copy( this.config.axes[2] ).applyMatrix3( m3 ).normalize(); // Z convert mesh config front axis from mesh coords to local coords
        xAxis.crossVectors( yAxis, zAxis ).normalize(); // x
        zAxis.crossVectors( xAxis, yAxis ).normalize(); // Z ensure orthogonality

        return { idx: boneIdx, lastFrameQuat: new THREE.Quaternion(), bindQuat: bindQuat, beforeBindAxes: [ xAxis, yAxis, zAxis ] }; // tiltFB, rotateRL, tiltRL || x,y,z
    }

    reset (){
        this.transition = false;
        this.tiltFB = [];
        this.tiltLR = [];
        this.rotateLR = [];
        this.forceBindPose();
    }

    forceBindPose(){
        for( let part in this.jointsData ){
            this.skeleton.bones[ this.jointsData[ part ].idx ].quaternion.copy( this.jointsData[ part ].bindQuat );
        }
    }

    forceLastFramePose(){
        for( let part in this.jointsData ){
            this.skeleton.bones[ this.jointsData[ part ].idx ].quaternion.copy( this.jointsData[ part ].lastFrameQuat );
        }
    }

    update( dt, forceBearing, forceElevation, forceTilt ){
        if ( !this.transition ){ return; }

        let transition = false;

        let tiltFBAngle = 0; //forceElevation;
        for ( let i = 0; i < this.tiltFB.length; ++i ){
            let o = this.tiltFB[i];
            o.update( dt );
            if ( !o.transition ){ this.tiltFB.splice( i, 1 ); --i; }
            tiltFBAngle += o.curValue;
            transition |= o.transition;
        }

        let tiltLRAngle = 0; //forceTilt;
        for ( let i = 0; i < this.tiltLR.length; ++i ){
            let o = this.tiltLR[i];
            o.update( dt );
            if ( !o.transition ){ this.tiltLR.splice( i, 1 ); --i; }
            tiltLRAngle += o.curValue;
            transition |= o.transition;
        }

        let rotateLRAngle = 0; //forceBearing;
        for ( let i = 0; i < this.rotateLR.length; ++i ){
            let o = this.rotateLR[i];
            o.update( dt );
            if ( !o.transition ){ this.rotateLR.splice( i, 1 ); --i; }
            rotateLRAngle += o.curValue;
            transition |= o.transition;
        }

        this.transition = transition;
        let q = this._tempQ_0;

        for( let part in this.jointsData ){
            let data = this.jointsData[ part ];
            let bone = this.skeleton.bones[ data.idx ];
            bone.quaternion.setFromAxisAngle( data.beforeBindAxes[1], rotateLRAngle *0.3333 ); // y
            q.setFromAxisAngle( data.beforeBindAxes[0], tiltFBAngle *0.3333); // x
            bone.quaternion.premultiply( q );
            q.setFromAxisAngle( data.beforeBindAxes[2], tiltLRAngle *0.3333); // z
            bone.quaternion.premultiply( q );
            bone.quaternion.premultiply( data.bindQuat ); // probably should MULTIPLY bind quat (previously adjusting axes)
            bone.quaternion.normalize();
            this.jointsData[part].lastFrameQuat.copy( bone.quaternion );
        }
    }

    newGestureBML( bml ){
        let amount = parseFloat( bml.amount );
        if ( isNaN( amount ) ){ amount = 1; }
        amount = amount * 15 * Math.PI / 180;
        let dstBuffer = null;
        switch( bml.bodyMovement ){
            case "TILT_LEFT": case "TL": amount *= -1;
            case "TILT_RIGHT": case "TR": dstBuffer = this.tiltLR;
                break;
            case "TILT_BACKWARD": case "TB": amount *= -1;
            case "TILT_FORWARD": case "TF": dstBuffer = this.tiltFB;
                break;
            case "ROTATE_RIGHT": case "RR": amount *= -1;
            case "ROTATE_LEFT": case "RL": dstBuffer = this.rotateLR;
                break;
        }

        if ( dstBuffer ){
            let b = new BasicBMLValueInterpolator(this.config, this.skeleton );
            b.newGestureBML( amount, bml.start, bml.attackPeak, bml.relax, bml.end );
            dstBuffer.push( b );
            this.transition = true;
        }

        return true;
    }
}




//@ECA controller

//States
CharacterController.prototype.WAITING = 0;
CharacterController.prototype.PROCESSING = 1;
CharacterController.prototype.SPEAKING = 2;
CharacterController.prototype.LISTENING = 3;

window.SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;

function CharacterController(o) {

    this.time = 0;
    this.character = o.character;
    this.characterConfig = o.characterConfig;
    
   // get skeleton
   this.skeleton = null;
   if(o.skeleton) {
       this.skeleton = o.skeleton;
   }
   else {
       this.character.traverse( ob => {
           if ( ob.isSkinnedMesh ) { this.skeleton = ob.skeleton; }
       } );
   }
   o.skeleton = this.skeleton;

    /** BoneMap */
    // config has a generic name to bone name map. Transform it into a mapping of generic name to bone index (in skeleton). 
    for ( let p in this.characterConfig.boneMap ){
        this.characterConfig.boneMap[ p ] = findIndexOfBoneByName( this.skeleton, this.characterConfig.boneMap[ p ] );            
    }
    
    if (typeof BehaviourManager !== 'undefined') {
        this.BehaviourManager = new BehaviourManager();
    }else {
        console.error("Manager not included");
    }

    if (typeof BehaviourPlanner !== 'undefined') {
        this.BehaviourPlanner = new BehaviourPlanner();
        this.BehaviourPlanner.BehaviourManager = this.BehaviourManager;
    } else {
        console.error("Planner not included");
    }

    if (typeof FacialController !== 'undefined') {
        this.facialController = new FacialController(o);
    } else {
        console.error("FacialController module not found");
    }

    if ( typeof(BodyController) !== 'undefined'){ 
        this.bodyController = new BodyController( this.character, this.skeleton, this.characterConfig );
    } 

    this.automaticFlags = {
        blink: true,
        browRaise: true, // if false, planner update returned block will be ignored
    }
}

// options.blink, options.browRaise. Undefined flags will not change
CharacterController.prototype.setAutomaticFlags = function ( options ) {
    if ( !options ){ return; }
    if ( options.hasOwnProperty( "autoBlink" ) ){ 
        this.automaticFlags.blink = !!options.autoBlink;
        if ( this.facialController && this.facialController.autoBlink ){ 
            this.facialController.autoBlink.setAuto( this.automaticFlags.blink ); 
        }
    }
    if ( options.hasOwnProperty( "autoBrowRaise" ) ){ 
        this.automaticFlags.browRaise = !!options.autoBrowRaise;
    }
}

// options.blink, options.browRaise. Undefined flags will not change
CharacterController.prototype.start = function ( options ) {
    this.pendingResources = [];
    if ( this.facialController ){ this.facialController.start( options ); }
    this.setAutomaticFlags( options );
}

CharacterController.prototype.reset = function ( keepEmotion = false ) {
    this.pendingResources.length = 0;

    if ( this.facialController ){ this.facialController.reset( keepEmotion ); }

    if (this.BehaviourPlanner){ this.BehaviourPlanner.reset(); }

    if (this.BehaviourManager){ this.BehaviourManager.reset(); }

    if (this.bodyController){ this.bodyController.reset(); }

    this.endSpeakingTime = -1;
    this.speaking = false;

}

CharacterController.prototype.update = function (dt, et) {
    let newBlock = null;
    this.time = et;

    if ( this.facialController ){ this.facialController.update(dt); }

    if (this.bodyController){ this.bodyController.update(dt) }

    if (this.BehaviourPlanner){ newBlock = this.BehaviourPlanner.update(dt); }

    if (this.BehaviourManager){ this.BehaviourManager.update(this.processBML.bind(this), et); }

    if ( newBlock && this.automaticFlags.browRaise ){ this.BehaviourManager.newBlock(newBlock, et); }

    // lipsync stuff????
    if ( this.facialController ){
        if (this.BehaviourManager.lgStack.length && this.BehaviourManager.time <= this.BehaviourManager.lgStack[this.BehaviourManager.lgStack.length - 1].endGlobalTime) {
            this.endSpeakingTime = this.BehaviourManager.lgStack[this.BehaviourManager.lgStack.length - 1].endGlobalTime + 1
            this.speaking = true;
        }
        else if (this.endSpeakingTime > -1 && this.BehaviourManager.time <= this.endSpeakingTime || this.facialController.lipsyncModule.working) {
            this.speaking = true;
        }
        else {
            this.endSpeakingTime = -1;
            this.speaking = false;
        }
    }

}

// Process message
// Messages can come from inner processes. "fromWS" indicates if a reply to the server is required in BMLManager.js
CharacterController.prototype.processMsg = function (data, fromWS) {
    if ( !data ){ return; }
    // Update to remove aborted blocks
    if (!this.BehaviourManager)
        return;

    this.BehaviourManager.update(this.processBML.bind(this), this.time);

    // Add new block to stack
    //this.BehaviourManager.newBlock(msg, thiscene.time);
    if(typeof(data) == "string"){ data = JSON.parse(data); }
    if (data.type == "behaviours"){ data = data.data; }

    // Add new blocks to stack
    let msg = {};

    if (data.constructor == Array) {
        // start and end times of whole message
        let end = -1000000;
        let start = 1000000;

        for (let i = 0; i < data.length; i++) {

            if (data[i].type == "info")
                continue;

            // data based on duration. Fix timings from increments to timestamps
            if (!data[i].end && data[i].duration) {
                data[i].end = data[i].start + data[i].duration;
                if (data[i].attackPeak) data[i].attackPeak += data[i].start;
                if (data[i].ready) data[i].ready += data[i].start;
                if (data[i].strokeStart) data[i].strokeStart += data[i].start;
                if (data[i].stroke) data[i].stroke += data[i].start;
                if (data[i].strokeEnd) data[i].strokeEnd += data[i].start;
                if (data[i].relax) data[i].relax += data[i].start;
            }

            // include data of type into msg
            if (!msg[data[i].type]) {
                msg[data[i].type] = [];
            }
            msg[data[i].type].push(data[i]);

            // update start-end of msg
            if (data[i].end > end) end = data[i].end;
            if (data[i].start < start) start = data[i].start;
        }

        msg.start = start;
        msg.end = end;

        if (!msg.composition)
            msg.composition = "MERGE";

        if ( msg.speech && ( msg.speech.constructor == Object || msg.speech.length ) ) {
            msg.control = this.SPEAKING;
        }

        // Process block
        // manages transitions if necessary
        if (this.BehaviourPlanner) {
            this.BehaviourPlanner.newBlock(msg);
        }
        // add blocks to stacks
        this.BehaviourManager.newBlock(msg, this.time);
    }

    else if (data.constructor == Object) {
        msg = data;
        if ( (data.type == "state" || data.type == "control") && data.parameters) {
            msg.control = this[data.parameters.state.toUpperCase()];
        }
        else if (data.type == "info")
            return;

        if ( msg.speech && ( msg.speech.constructor == Object || msg.speech.length ) ) {
            msg.control = this.SPEAKING;
        }
        // Process block
        // manages transitions if necessary
        if (this.BehaviourPlanner) {
            this.BehaviourPlanner.newBlock(msg);
        }
        // add blocks to stacks
        this.BehaviourManager.newBlock(msg, this.time);
     }

    if (fromWS)
        msg.fromWS = fromWS;

    // Client id -> should be characterId?
    if (msg.clientId && !this.ws.id) {
        this.ws.id = msg.clientId;
        console.log("Client ID: ", msg.clientId);
        return;
    }

    // Load audio files
    if (msg.lg) {
        let hasToLoad = this.loadAudio(msg);
        if (hasToLoad) {
            this.pendingResources.push(msg);
            console.log("Needs to preload audio files.");
            return;
        }
    }

    if (!msg) {
        console.error("An undefined msg has been received.", msg);
        return;
    }

    // Update to remove aborted blocks
    if (!this.BehaviourManager)
        return;

    this.BehaviourManager.update(this.processBML.bind(this), this.time);

    if (!msg) {
        console.error("An undefined block has been created due to the update of BMLManager.", msg);
        return;
    }
}

// Process message
CharacterController.prototype.processBML = function (key, bml) {

    if ( ( !this.facialController && key != "gesture" ) || ( !this.bodyController && key == "gesture" ) )
        return;

    let thatFacial = this.facialController;

    switch (key) {
        case "blink":
            thatFacial.newBlink(bml);
            break;
        case "gaze":
            thatFacial.newGaze(bml, !!bml.shift); // !!shift make it bool (just in case)
            break;
        case "gazeShift":
            thatFacial.newGaze(bml, true);
            break;
        case "head":
            thatFacial.newHeadBML(bml);
            break;
        case "headDirectionShift":
            thatFacial.headDirectionShift(bml);
            break;
        case "face":
            thatFacial.newFA(bml, !!bml.shift); // !!shift make it bool (just in case)
            break;
        case "faceLexeme":
            thatFacial.newFA(bml, !!bml.shift); // !!shift make it bool (just in case)
            break;
        case "faceFACS":
            thatFacial.newFA(bml, false);
            break;
        case "faceEmotion":
            thatFacial.newFA(bml, !!bml.shift); // !!shift make it bool (just in case)
            break;
        case "faceVA":
            thatFacial.newFA(bml, !!bml.shift); // !!shift make it bool (just in case)
            break;
        case "faceShift":
            thatFacial.newFA(bml, true);
            break;
        case "speech":
            if (bml.phT)
                bml.phT = new Float32Array(Object.values(bml.phT));
            thatFacial.newTextToLip(bml);
            break;
        case "gesture":
            this.bodyController.newGesture( bml );
            break;
        case "animation":
            // TODO
            break;
        case "lg":
            thatFacial.newLipsync( bml );
            break;
    }
}

// Preloads audios to avoid loading time when added to BML stacks
CharacterController.prototype.loadAudio = function (block) {
    let output = false;
    if (block.lg.constructor === Array) {
        for (let i = 0; i < block.lg.length; i++) {
        if (!block.lg[i].audio) {
            block.lg[i].audio = new Audio();
            block.lg[i].audio.src = block.lg[i].url;
            output = true;
        }
        }
    }
    else {
        if (!block.lg.audio) {
            block.lg.audio = new Audio();
            block.lg.audio.src = block.lg.url;
            output = true;
        }
    }

    return output;
}
//@FacialController


function FacialController(config = null) {
    
    // define some properties
    this._gazePositions = {
        "RIGHT": new THREE.Vector3(-30, 2, 100), "LEFT": new THREE.Vector3(30, 2, 100),
        "UP": new THREE.Vector3(0, 20, 100), "DOWN": new THREE.Vector3(0, -20, 100),
        "UP_RIGHT": new THREE.Vector3(-30, 20, 100), "UP_LEFT": new THREE.Vector3(30, 20, 100),
        "DOWN_RIGHT": new THREE.Vector3(-30, -20, 100), "DOWN_LEFT": new THREE.Vector3(30, -20, 100),
        "FRONT": new THREE.Vector3(0, 2, 100), "CAMERA": new THREE.Vector3(0, 2, 100)
    };

    this._morphTargets = {}; // current avatar morph targets
    this._avatarParts = {}; // list of AU in each mesh of the avatar
    this._boneMap = {}; // bone name to index mapper
    this._mappingAU2BS = {}; // mappings of current (target) avatar BS to default (source) action units
    
    // default action units
    this._actionUnits = {
        "dictionary": {
                "Inner_Brow_Raiser": 0, "Outer_Brow_Raiser_Left": 1, "Outer_Brow_Raiser_Right": 2, "Brow_Lowerer_Left": 3, "Brow_Lowerer_Right": 4, "Nose_Wrinkler_Left": 5, "Nose_Wrinkler_Right": 6, "Nostril_Dilator": 7, "Nostril_Compressor": 8,
                "Dimpler_Left": 9, "Dimpler_Right": 10, "Upper_Lip_Raiser_Left": 11, "Upper_Lip_Raiser_Right": 12, "Lip_Corner_Puller_Left": 13, "Lip_Corner_Puller_Right": 14, "Lip_Corner_Depressor_Left": 15, "Lip_Corner_Depressor_Right": 16,
                "Lower_Lip_Depressor_Left": 17, "Lower_Lip_Depressor_Right": 18, "Lip_Puckerer_Left": 19, "Lip_Puckerer_Right": 20, "Lip_Stretcher_Left": 21, "Lip_Stretcher_Right": 22, "Lip_Funneler": 23, "Lip_Pressor_Left": 24, "Lip_Pressor_Right": 25,
                "Lips_Part": 26, "Lip_Suck_Upper": 27, "Lip_Suck_Lower": 28, "Lip_Wipe": 29, "Tongue_Up": 30, "Tongue_Show": 31, "Tongue_Bulge_Left": 32, "Tongue_Bulge_Right": 33, "Tongue_Wide": 34, "Mouth_Stretch": 35, "Jaw_Drop": 36, "Jaw_Thrust": 37,
                "Jaw_Sideways_Left": 38, "Jaw_Sideways_Right": 39, "Chin_Raiser": 40, "Cheek_Raiser_Left": 41, "Cheek_Raiser_Right": 42, "Cheek_Blow_Left": 43, "Cheek_Blow_Right": 44, "Cheek_Suck_Left": 45, "Cheek_Suck_Right": 46, "Upper_Lid_Raiser_Left": 47,
                "Upper_Lid_Raiser_Right": 48, "Squint_Left": 49, "Squint_Right": 50, "Blink_Left": 51, "Blink_Right": 52, "Wink_Left": 53, "Wink_Right": 54, "Neck_Tightener": 55
            },
        "influences": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    this._eyeLidsAU = [51, 52]; // idx number of eyelids related AU - gaze and blink easy access
    this._squintAU = [49, 50]; // idx number of squint related AU - gaze and blink easy access
    
    // weighting factor for t2l interface
    this._t2lMap = {
        "kiss": ["Lip_Puckerer_Left", "Lip_Puckerer_Right"],
        "upperLipClosed": ["Lip_Suck_Upper"], 
        "lowerLipClosed": ["Lip_Suck_Lower"],
        "jawOpen": ["Mouth_Stretch"],
        "tongueFrontUp": ["Tongue_Up"],
        "tongueOut": ["Tongue_Show"],
    };

    // TODO: update a2l names ?
    this.lipsPressedBSName = "Jaw_Up";
    this.lowerLipINBSName = "Lip_Suck_Lower";
    this.lowerLipDownBSName = "Lower_Lip_Depressor_Left";
    this.mouthNarrowBSName = "MouthNarrow";
    this.mouthOpenBSName = "MouthOpen";
        
    this.lipsyncModule = new Lipsync();

    // if we have the state passed, then we restore the state
    if (config)
        this.configure(config);
}


FacialController.prototype.configure = function (o) {

    if (o.character) {
        this.character = o.character;
        this.skeleton = o.skeleton;
    }
    
    if (o.gazePositions) this._gazePositions = o.gazePositions;
    if (o.morphTargets) this._morphTargets = o.morphTargets;

    if(o.characterConfig) {
        this._mappingAU2BS = o.characterConfig.faceController.blendshapeMap;
        this._boneMap = o.characterConfig.boneMap;
        this._avatarParts = o.characterConfig.faceController.parts;
    }
}

FacialController.prototype.start = function ( options ) {

    this._morphTargets = {}; // map "name" of part to its scene obj
    for (const part in this._avatarParts) {
        let obj = this.character.getObjectByName(part);
        if ( !obj || !obj.morphTargetDictionary || !obj.morphTargetInfluences ){
            console.log( "FacialController: \"" + part + "\" object could not be found in the avatar" );
            delete this._avatarParts[ part ];
            continue;
        }
        this._morphTargets[part] = obj;

        if ( !Array.isArray( this._avatarParts[part] ) ){ // if not array of AU provided for this part, use all AUs
            this._avatarParts[part] = Object.keys(this._actionUnits.dictionary);
        }

    }
        
    this._facialAUAcc = this._actionUnits.influences.slice(); // clone array;
    this._facialAUFinal = this._actionUnits.influences.slice(); // clone array;

    if (!this._morphTargets) {
        console.error("Morph deformer not found");
        return;
    }
    
    this.resetFace();

    this._FacialLexemes = [];
    this.FA = new FacialEmotion(this._facialAUFinal);
    
    // Gaze
    // Get head bone node
    if (!this._boneMap.Head)
    console.error("Head bone node not found with id: ");
    else if (!this._gazePositions["HEAD"]) {
        let headNode = this.skeleton.bones[this._boneMap.Head];
        this._gazePositions["HEAD"] = headNode.getWorldPosition(new THREE.Vector3());
    }

    // Get lookAt nodes  
    let lookAtEyesNode = this.character.eyesTarget;
    let lookAtNeckNode = this.character.neckTarget;
    let lookAtHeadNode = this.character.headTarget;

    if (!this._gazePositions["EYESTARGET"]){ this._gazePositions["EYESTARGET"] = lookAtEyesNode.getWorldPosition(new THREE.Vector3()); }
    if (!this._gazePositions["HEADTARGET"]){ this._gazePositions["HEADTARGET"] = lookAtHeadNode.getWorldPosition(new THREE.Vector3()); }
    if (!this._gazePositions["NECKTARGET"]){ this._gazePositions["NECKTARGET"] = lookAtNeckNode.getWorldPosition(new THREE.Vector3()); }

    // Gaze manager
    this.gazeManager = new GazeManager(lookAtNeckNode, lookAtHeadNode, lookAtEyesNode, this._gazePositions);

    this.headBML = []; //null;

    this.autoBlink = new Blink( false );
    this.autoBlink.setAuto( ( options && options.hasOwnProperty( "autoBlink" ) ) ? options.autoBlink : true );
}

FacialController.prototype.reset = function ( keepEmotion = false ) {
    
    this.resetFace(); // blendshapes to 0
    
    if ( this.textToLip ) { this.textToLip.cleanQueueSentences( true ); }
    if ( this.lipsyncModule ) { this.lipsyncModule.stop(); }

    this._FacialLexemes.length = 0;
    if ( !keepEmotion ){ this.FA.reset(); } 

    this.gazeManager.reset();
    this.headBML.length = 0;

    if( this.blink ){ this.blink.reset(); }
}

FacialController.prototype.resetFace = function () {
    for (let i = 0; i < this._facialAUFinal.length; i++) {
        this._facialAUAcc[i] = 0;
        this._facialAUFinal[i] = 0;
        this._actionUnits.influences[i] = 0;
    }
}

/**  public update function (update inner BS and map them to current avatar) */ 
FacialController.prototype.update = function (dt) {

    // Update Facial BlendShapes
    this.innerUpdate(dt);

    // Map facialBS to current model BS
    let targetAccumulatedValues = {}; // store multiple value for each target
    
    for (let AUName in this._mappingAU2BS) {
        let avatarBSnames = this._mappingAU2BS[AUName]; // array of target avatar BS [names, factor]
        
        let idx = this._actionUnits.dictionary[AUName]; // index of source blendshape
        let value = this._actionUnits.influences[idx]; // value of source blendshape
        
        // map source value to all target BS
        for (let i = 0; i < avatarBSnames.length; i++) {
            let targetBSName = avatarBSnames[i][0];
            let targetBSFactor = avatarBSnames[i][1];
            
            if (!targetAccumulatedValues[targetBSName]) { targetAccumulatedValues[targetBSName] = []; }
            targetAccumulatedValues[targetBSName].push(value * targetBSFactor); // store the value in the array for this target
        }
    }
    
    // compute the mean influence value for each target
    for (let part in this._avatarParts) {
        // get AU names that influence current mesh (if null uses all AUs)
        let AUnames = this._avatarParts[part] ? this._avatarParts[part] : Object.keys(this._actionUnits.dictionary);
        for (let i = 0; i < AUnames.length; i++) {
            let avatarBSnames = this._mappingAU2BS[AUnames[i]] ? this._mappingAU2BS[AUnames[i]] : [];
            for (let i = 0; i < avatarBSnames.length; i++) {
                let targetBSName = avatarBSnames[i][0];
                let values = targetAccumulatedValues[targetBSName] ? targetAccumulatedValues[targetBSName] : [];
                let meanValue = 0;
                let acc = 0;
                let final = 0;

                // compute biased average
                for (let i = 0; i < values.length; i++) {
                    acc += Math.abs(values[i]);
                    final += values[i] * Math.abs(values[i]);
                }
                if (acc > 0.0001) meanValue = final / acc;
        
                // update the target blendshape with the mean value
                let targetIdx = this._morphTargets[part].morphTargetDictionary[targetBSName];
                if (targetIdx !== undefined) {
                    this._morphTargets[part].morphTargetInfluences[targetIdx] = meanValue;
                }
            }
        }
    }
}
    
//example of one method called for ever update event
FacialController.prototype.innerUpdate = function (dt) {

    // Update facial expression
    this.faceUpdate(dt);

    let lookAtEyes = this.character.eyesTarget.getWorldPosition(new THREE.Vector3());
    let lookAtHead = this.character.headTarget.getWorldPosition(new THREE.Vector3());
    let lookAtNeck = this.character.neckTarget.getWorldPosition(new THREE.Vector3());
    
    this.skeleton.bones[this._boneMap.Neck].lookAt(lookAtNeck);
    this.skeleton.bones[this._boneMap.Head].lookAt(lookAtHead);
    
    // HEAD (nod, shake, tilt, tiltleft, tiltright, forward, backward)
    let headQuat = this.skeleton.bones[this._boneMap.Head].quaternion; // Not a copy, but a reference
    let neckQuat = this.skeleton.bones[this._boneMap.Neck].quaternion; // Not a copy, but a reference
    for( let i = 0; i< this.headBML.length; ++i){
        let head = this.headBML[i];
        if( !head.transition ){
            this.headBML.splice(i,1);
            --i;
            continue;
        }
        head.update(dt);
        if(head.lexeme == "FORWARD" || head.lexeme == "BACKWARD") {
            neckQuat.multiply( head.currentStrokeQuat );
            headQuat.multiply( head.currentStrokeQuat.invert() );
            head.currentStrokeQuat.invert(); // inverting quats is cheap
        } 
        else
            headQuat.multiply( head.currentStrokeQuat );
    }

    this.skeleton.bones[this._boneMap.LEye].lookAt(lookAtEyes);
    this.skeleton.bones[this._boneMap.REye].lookAt(lookAtEyes);
}

// Update facial expressions
FacialController.prototype.faceUpdate = function (dt) {
    
    // reset accumulators for biased average
    this._facialAUAcc.fill(0);
    this._facialAUFinal.fill(0);
    
    // Text to lip
    if (this.textToLip && this.textToLip.getCompactState() == 0) { // when getCompactState==0 lipsync is working, not paused and has sentences to process
        this.textToLip.update(dt);
        let t2lBSW = this.textToLip.getBSW(); // reference, not a copy
        for (let i = 0; i < this.textToLipBSMapping.length; i++) {
            let mapping = this.textToLipBSMapping[i];
            let value = Math.min(1, Math.max(-1, t2lBSW[mapping[1]]));
            let index = mapping[0];
            // for this model, some blendshapes need to be negative
            this._facialAUAcc[index] += Math.abs(value); // denominator of biased average
            this._facialAUFinal[index] += value * Math.abs(value); // numerator of biased average
        }
    }

    // lipsync
    if (this.lipsyncModule && this.lipsyncModule.working) // audio to lip
    {
        this.lipsyncModule.update(dt);
        let facialLexemes = this.lipsyncModule.BSW;
        if (facialLexemes) {

            let smooth = 0.66;
            let BSAcc = this._facialAUAcc;
            let BSFin = this._facialAUFinal;
            let BS = this._actionUnits.influences; // for smoothing purposes
            let morphDict = this._actionUnits.dictionary;
            // search every morphTarget to find the proper ones
            let names = Object.keys(morphDict);
            for (let i = 0; i < names.length; i++) {

                let name = names[i];
                let bsIdx = morphDict[name];
                let value = 0;
                if (name.includes(this.mouthOpenBSName))
                    value = (1 - smooth) * BS[bsIdx] + smooth * facialLexemes[2];

                if (name.includes(this.lowerLipINBSName))
                    value = (1 - smooth) * BS[bsIdx] + smooth * facialLexemes[1];

                if (name.includes(this.lowerLipDownBSName))
                    value = (1 - smooth) * BS[bsIdx] + smooth * facialLexemes[1];

                if (name.includes(this.mouthNarrowBSName))
                    value = (1 - smooth) * BS[bsIdx] + smooth * facialLexemes[0] * 0.5;

                if (name.includes(this.lipsPressedBSName))
                    value = (1 - smooth) * BS[bsIdx] + smooth * facialLexemes[1];

                BSAcc[bsIdx] += Math.abs(value); // denominator of biased average
                BSFin[bsIdx] += value * Math.abs(value); // numerator of biased average

            }
        }
    }

    //FacialEmotion ValAro/Emotions
    this.FA.updateVABSW(dt);

    for (let j = 0; j < this.FA.currentVABSW.length; j++) {
        let value = this.FA.currentVABSW[j];
        this._facialAUAcc[j] += Math.abs(value); // denominator of biased average
        this._facialAUFinal[j] += value * Math.abs(value); // numerator of biased average
    }

    // FacialExpr lexemes
    for (let k = 0; k < this._FacialLexemes.length; k++) {
        let lexeme = this._FacialLexemes[k];
        if (lexeme.transition) {
            lexeme.updateLexemesBSW(dt);
            // accumulate blendshape values
            for (let i = 0; i < lexeme.indicesLex.length; i++) {
                for (let j = 0; j < lexeme.indicesLex[i].length; j++) {
                    let value = lexeme.currentLexBSW[i][j];
                    let index = lexeme.indicesLex[i][j];
                    this._facialAUAcc[index] += Math.abs(value); // denominator of biased average
                    this._facialAUFinal[index] += value * Math.abs(value); // numerator of biased average
                }
            }
        }

        // remove lexeme if finished
        if (!lexeme.transition) {
            this._FacialLexemes.splice(k, 1);
            --k;
        }
    }

    // Gaze
    if (this.gazeManager){
        let weights = this.gazeManager.update(dt);

        // eyelids update
        for(let i = 0; i< this._eyeLidsAU.length; i++){         
            this._facialAUAcc[ this._eyeLidsAU[i] ] += Math.abs(weights.eyelids);
            this._facialAUFinal[ this._eyeLidsAU[i] ] += weights.eyelids * Math.abs(weights.eyelids);
        }
        // squint update
        for(let i = 0; i< this._squintAU.length; i++){         
            this._facialAUAcc[ this._squintAU[i] ] += Math.abs(weights.squint);
            this._facialAUFinal[ this._squintAU[i] ] += weights.squint * Math.abs(weights.squint);
        }
    }


    // Second pass, compute mean (division)
    // result = ( val1 * |val1|/|sumVals| ) + ( val2 * |val2|/|sumVals| ) + ...
    // copy blendshape arrays back to real arrays and compute biased average  
    let target = this._facialAUFinal;
    let numerator = this._facialAUFinal;
    let acc = this._facialAUAcc;
    for (let i = 0; i < target.length; ++i) {
        if (acc[i] < 0.0001) { target[i] = 0; }
        else { target[i] = numerator[i] / acc[i]; }
    }

    // --- UPDATE POST BIASED AVERAGE --- 
    // this._facialAUFinal has all the valid values

    // Eye blink
    if ( this.autoBlink.state ) {
        this.autoBlink.update(dt, this._facialAUFinal[this._eyeLidsAU[0]], this._facialAUFinal[this._eyeLidsAU[1]]);
        this._facialAUFinal[this._eyeLidsAU[0]] = this.autoBlink.weights[0];
        this._facialAUFinal[this._eyeLidsAU[1]] = this.autoBlink.weights[1];
    }

    // "Render" final facial (body) blendshapes
    // copy blendshape arrays back to real arrays
    let tar = this._actionUnits.influences;
    let source = this._facialAUFinal;
    for (let i = 0; i < tar.length; ++i) {
        tar[i] = source[i];
    }

}


// ----------------------- TEXT TO LIP --------------------
// Create a Text to Lip mouthing
FacialController.prototype.newTextToLip = function (bml) {
    
    if (!this.textToLip) { // setup

        this.textToLip = new Text2LipInterface();
        this.textToLip.start(); // keep started but idle
        this.textToLipBSMapping = []; // array of [ MeshBSIndex, T2Lindex ]

        let t2lBSWMap = T2LTABLES.BlendshapeMapping;

        // map blendshapes to text2lip output
        for(const part in this._t2lMap) {
            for(let i = 0; i < this._t2lMap[part].length; i++) {
                // instead of looping through all BS, access directly the index of the desired blendshape
                let idx = this._actionUnits.dictionary[this._t2lMap[part][i]];
                if (idx) this.textToLipBSMapping.push([ idx, t2lBSWMap[part]]);
            }
        }
    }

    let text = bml.text;
    if ( text[ text.length - 1 ] != "." ){ text += "."; } 
    this.textToLip.cleanQueueSentences();
    this.textToLip.pushSentence(bml.text, bml); // use info object as options container also  
}


// --------------------- lipsync --------------------------------
// Create a Text to Lip mouthing
FacialController.prototype.newLipsync = function (bml) {
    
    if (!this.lipsyncModule)
        return;

    if (bml.audio)
        this.lipsyncModule.loadBlob(bml.audio);
    else if (bml.url)
        this.lipsyncModule.loadSample(bml.url);
}


// --------------------- FACIAL EXPRESSIONS ---------------------
// BML
// <face or faceShift start attackPeak relax* end* valaro
// <faceLexeme start attackPeak relax* end* lexeme amount
// <faceFacs not implemented>
// lexeme  [OBLIQUE_BROWS, RAISE_BROWS,
//      RAISE_LEFT_BROW, RAISE_RIGHT_BROW,LOWER_BROWS, LOWER_LEFT_BROW,
//      LOWER_RIGHT_BROW, LOWER_MOUTH_CORNERS,
//      LOWER_LEFT_MOUTH_CORNER,
//      LOWER_RIGHT_MOUTH_CORNER,
//      RAISE_MOUTH_CORNERS,
//      RAISE_RIGHT_MOUTH_CORNER,
//      RAISE_LEFT_MOUTH_CORNER, OPEN_MOUTH,
//      OPEN_LIPS, WIDEN_EYES, CLOSE_EYES]
//
// face/faceShift can contain several sons of type faceLexeme without sync attr
// valaro Range [-1, 1]

// TODO: THIS CAUSES PROBLEMS????
// Declare new facial expression
FacialController.prototype.newFA = function (faceData, shift) {
    
    // Use BSW of the agent
    for (let i = 0; i < this._facialAUFinal.length; i++) {
        this._facialAUFinal[i] = this._actionUnits.influences[i];
    }
    if (faceData.emotion || faceData.valaro) {
        this.FA.initFaceValAro(faceData, shift, this._facialAUFinal); // new FacialExpr (faceData, shift, this._facialAUFinal);
    }
    else if (faceData.lexeme) {
        this._FacialLexemes.push(new FacialExpr(faceData, shift, this._facialAUFinal));
    }

}

// --------------------- BLINK ---------------------
FacialController.prototype.newBlink = function ( bml ){
    this.autoBlink.blink();
}

// --------------------- GAZE ---------------------
// BML
// <gaze or gazeShift start ready* relax* end influence target influence offsetAngle offsetDirection>
// influence [EYES, HEAD, NECK, SHOULDER, WAIST, WHOLE, ...]
// offsetAngle relative to target
// offsetDirection (of offsetAngle) [RIGHT, LEFT, UP, DOWN, UP_RIGHT, UP_LEFT, DOWN_LEFT, DOWN_RIGHT]
// target [CAMERA, RIGHT, LEFT, UP, DOWN, UP_RIGHT, UP_LEFT, DOWN_LEFT, DOWN_RIGHT]

// "HEAD" position is added on Start

FacialController.prototype.newGaze = function (gazeData, shift, gazePositions = null) {

    // TODO: recicle gaze in gazeManager
    let blinkW = this._facialAUFinal[0]
    let eyelidsW = this._facialAUFinal[this._eyeLidsAU[0]]
    let squintW = this._facialAUFinal[this._squintAU[0]]
    gazeData.eyelidsWeight = eyelidsW;
    gazeData.squintWeight = squintW;
    gazeData.blinkWeight = blinkW;

    this.gazeManager.newGaze(gazeData, shift, gazePositions, !!gazeData.headOnly);

}

// BML
// <headDirectionShift start end target>
// Uses gazeBML
FacialController.prototype.headDirectionShift = function (headData, cmdId) {
    
    headData.end = headData.end || 2.0;
    headData.influence = "HEAD";
    this.newGaze(headData, true, null, true);
}

// --------------------- HEAD ---------------------
// BML
// <head start ready strokeStart stroke strokeEnd relax end lexeme repetition amount>
// lexeme [NOD, SHAKE, TILT, TILT_LEFT, TILT_RIGHT, FORWARD, BACKWARD]
// repetition cancels stroke attr
// amount how intense is the head nod? 0 to 1
// New head behavior
FacialController.prototype.newHeadBML = function (headData) {
    
    // work with indexes instead of names
    let node = headData.lexeme == "FORWARD" || headData.lexeme == "BACKWARD" ? this._boneMap.Neck : this._boneMap.Head;
    let bone = this.skeleton.bones[node]; // let bone = this.character.getObjectByName(node);
    if (bone) {
        this.headBML.push(new HeadBML(headData, bone, bone.quaternion.clone()));
    }
}





// characterConfig is modified by bodyController
class BodyController{
    
    constructor( character, skeleton, characterConfig ){
        this.character = character;
        this.skeleton = skeleton;
        this.computeConfig( characterConfig );

        // -------------- All modules --------------
        forceBindPoseQuats( this.skeleton, true ); // so all modules can setup things in bind pose already
        this.character.updateWorldMatrix( true, true );
        this.right = this._createArm( false );
        this.left = this._createArm( true );
        this.handConstellation = new HandConstellation( this.config.boneMap, this.skeleton, this.config.handLocationsR, this.config.handLocationsL );
        this.bodyMovement = new BodyMovement( this.config, this.skeleton );

        this.dominant = this.right;
        this.nonDominant = this.left;

        this._tempQ_0 = new THREE.Quaternion();
        this._tempQ_1 = new THREE.Quaternion();
        this._tempV3_0 = new THREE.Vector3();
        this._tempV3_1 = new THREE.Vector3();

        this.foreArmFactor = 0.6;
    }

    computeConfig( jsonConfig ){
        // reference, not a copy. All changes also affect the incoming characterConfig
        this.config = jsonConfig.bodyController; 

        this.config.boneMap = jsonConfig.boneMap; // reference, not a copy

        /** Main Avatar Axes in Mesh Coordinates */
        if ( this.config.axes ){ 
            for( let i = 0; i < this.config.axes.length; ++i ){ // probably axes are a simple js object {x:0,y:0,z:0}. Convert it to threejs
                this.config.axes[i] = new THREE.Vector3(  this.config.axes[i].x, this.config.axes[i].y, this.config.axes[i].z ); 
            }
        } else{ 
            // compute axes in MESH coordinates using the the Bind pose ( TPose mandatory )
            // MESH coordinates: the same in which the actual vertices are located, without any rigging or any matrix applied
            this.config.axes = [ new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3() ]; // x,y,z
            let boneMap = this.config.boneMap;
            this.skeleton.bones[ boneMap.Hips ].updateWorldMatrix( true, true ); // parents and children also
    
            let a = (new THREE.Vector3()).setFromMatrixPosition( this.skeleton.boneInverses[ boneMap.LShoulder ].clone().invert() );
            let b = (new THREE.Vector3()).setFromMatrixPosition( this.skeleton.boneInverses[ boneMap.RShoulder ].clone().invert() );
            this.config.axes[0].subVectors( a, b ).normalize(); // x
    
            a = a.setFromMatrixPosition( this.skeleton.boneInverses[ boneMap.BelowStomach ].clone().invert() );
            b = b.setFromMatrixPosition( this.skeleton.boneInverses[ boneMap.Hips ].clone().invert() );
            this.config.axes[1].subVectors( a, b ).normalize(); // y
            
            this.config.axes[2].crossVectors( this.config.axes[0], this.config.axes[1] ).normalize(); // z = cross( x, y )
            this.config.axes[1].crossVectors( this.config.axes[2], this.config.axes[0] ).normalize(); // y = cross( z, x )
        }

        /** Body and Hand Locations */
        // create location point objects and attach them to bones
        function locationToObjects( table, skeleton, symmetry = false ){
            let result = {};
            for( let name in table ){
                let l = table[ name ];
                
                let idx = findIndexOfBoneByName( skeleton, symmetry ? l[0].replace( "Right", "Left" ) : l[0] );
                if ( idx < 0 ){ continue; }
                
                let o = new THREE.Object3D();
                // let o = new THREE.Mesh( new THREE.SphereGeometry(0.3,16,16), new THREE.MeshStandardMaterial( { color: Math.random()*0xffffff }) );
                o.position.copy( l[1] ).applyMatrix4( skeleton.boneInverses[ idx ] ); // from mesh space to bone local space
                
                // check direction of distance vector 
                if ( l[2] ){
                    let m3 = new THREE.Matrix3();
                    m3.setFromMatrix4( skeleton.boneInverses[ idx ] );
                    o.direction = (new THREE.Vector3()).copy( l[2] ).applyMatrix3( m3 );
                }
                // o.position.copy( l[1] );
                // if ( symmetry ){ o.position.x *= -1; }
                o.name = name;
                skeleton.bones[ idx ].add( o );
                result[ name ] = o;
            }
            return result;   
        }
        this.config.bodyLocations = locationToObjects( this.config.bodyLocations, this.skeleton, false );
        this.config.handLocationsL = locationToObjects( this.config.handLocationsL ? this.config.handLocationsL : this.config.handLocationsR, this.skeleton, !this.config.handLocationsL ); // assume symmetric mesh/skeleton
        this.config.handLocationsR = locationToObjects( this.config.handLocationsR, this.skeleton, false ); // since this.config is being overwrite, generate left before right

        /** default elbow raise, shoulder raise, shoulder hunch */
        let correctedDefaultAngles = {
            elbowRaise: 0,
            shoulderRaise: [ 0, -5 * Math.PI/180, 45 * Math.PI/180 ], // always present angle, min angle, max angle
            shoulderHunch: [ 0, -10 * Math.PI/180, 55 * Math.PI/180 ], // always present angle, min angle, max angle
        }
        if ( typeof( this.config.elbowRaise ) == "number" ){ correctedDefaultAngles.elbowRaise = this.config.elbowRaise * Math.PI/180; }
        if ( Array.isArray( this.config.shoulderRaise ) ){ 
            for( let i = 0; i < 3 && i < this.config.shoulderRaise.length; ++i ){ 
                correctedDefaultAngles.shoulderRaise[i] = this.config.shoulderRaise[i] * Math.PI/180; 
            } 
            if ( correctedDefaultAngles.shoulderRaise[1] > 0 ){ correctedDefaultAngles.shoulderRaise[1] = 0; }
            if ( correctedDefaultAngles.shoulderRaise[2] < 0 ){ correctedDefaultAngles.shoulderRaise[2] = 0; }
        }
        if ( Array.isArray( this.config.shoulderHunch ) ){ 
            for( let i = 0; i < 3 && i < this.config.shoulderHunch.length; ++i ){ 
                correctedDefaultAngles.shoulderHunch[i] = this.config.shoulderHunch[i] * Math.PI/180; 
            } 
            if ( correctedDefaultAngles.shoulderHunch[1] > 0 ){ correctedDefaultAngles.shoulderHunch[1] = 0; }
            if ( correctedDefaultAngles.shoulderHunch[2] < 0 ){ correctedDefaultAngles.shoulderHunch[2] = 0; }
        }
        this.config.elbowRaise = correctedDefaultAngles.elbowRaise;
        this.config.shoulderRaise = correctedDefaultAngles.shoulderRaise;
        this.config.shoulderHunch = correctedDefaultAngles.shoulderHunch;

        /** finger angle ranges */
        let angleRanges = [ // in case of config...
            [ [ 0, 45*Math.PI/180 ] ],//[ [ 0, Math.PI * 0.2 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.4 ], [ 0, Math.PI * 0.4 ] ],  // [ splay, base, mid, high ]
            [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
            [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
            [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
            [ [ 0, 20*Math.PI/180 ], [ 0, Math.PI * 0.5 ], [ 0, Math.PI * 0.6 ], [ 0, Math.PI * 0.5 ] ], // [ splay, base, mid, high ]
        ];
        if ( Array.isArray( this.config.fingerAngleRanges ) ){
            let userAngleRanges = this.config.fingerAngleRanges;
            for( let i = 0; i < angleRanges.length && i < userAngleRanges.length; ++i ){ // for each finger available
                let fingerRanges = angleRanges[i];
                let userFingerRanges = userAngleRanges[i]
                if( !Array.isArray( userFingerRanges ) ){ continue; }
                for( let j = 0; j < fingerRanges.length && j < userFingerRanges.length; ++j ){ // for each range in the finger available
                    let range = fingerRanges[j];
                    let userRange = userFingerRanges[j];
                    if ( !Array.isArray( userRange ) || userRange.length < 2 ){ continue; }
                    let v = userRange[0] * Math.PI / 180; 
                    range[0] = isNaN( v ) ? range[0] : v; 
                    v = userRange[1] * Math.PI / 180; 
                    range[1] = isNaN( v ) ? range[1] : v; 
                }
            }
        }
        this.config.fingerAngleRanges = angleRanges;


    }
    _createArm( isLeftHand = false ){
        return {
            loc: new LocationBodyArm( this.config, this.skeleton, isLeftHand ),
            locMotions: [],
            extfidirPalmor: new ExtfidirPalmor( this.config, this.skeleton, isLeftHand ),
            wristMotion: new WristMotion( this.config, this.skeleton, isLeftHand ),
            handshape: new HandShape( this.config, this.skeleton, isLeftHand ),
            fingerplay: new FingerPlay(),
            elbowRaise: new ElbowRaise( this.config, this.skeleton, isLeftHand ),
            shoulderRaise: new ShoulderRaise( this.config, this.skeleton, isLeftHand ),
            shoulderHunch: new ShoulderHunch( this.config, this.skeleton, isLeftHand ),

            needsUpdate: false,
            ikSolver: new GeometricArmIK( this.skeleton, this.config, isLeftHand ),
            locUpdatePoint: new THREE.Vector3(0,0,0),
            _tempWristQuat: new THREE.Quaternion(0,0,0,1), // stores computed extfidir + palmor before any arm movement applied. Necessary for locBody + handConstellation

        };
    }

    _resetArm( arm ){
        arm.loc.reset();
        arm.locMotions = [];
        arm.wristMotion.reset();
        arm.handshape.reset();
        arm.fingerplay.reset();
        arm.elbowRaise.reset();
        arm.shoulderRaise.reset();
        arm.shoulderHunch.reset();
        arm.locUpdatePoint.set(0,0,0);
        arm.needsUpdate = false;

        arm.extfidirPalmor.reset();

    }
    
    reset(){

        this.bodyMovement.reset();
        this.handConstellation.reset();
        this._resetArm( this.right );
        this._resetArm( this.left );

        // this posture setting is quite hacky. To avoid dealing with handConstellation shift (not trivial)
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, locationBodyArm: "neutral", hand: "RIGHT", distance: 0.0251, srcContact:"HAND_PALMAR", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, locationBodyArm: "neutral", hand: "LEFT",  distance: 0.0251, srcContact:"HAND_PALMAR", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, handshape: "FLAT", mainBend: "ROUND", tco:0.5, thumbshape: "TOUCH", hand: "RIGHT", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, handshape: "FLAT", mainBend: "ROUND", tco:0.75, thumbshape: "TOUCH", hand: "LEFT", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, palmor: "l", hand: "RIGHT", shift: true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, palmor: "r", hand: "LEFT", shift: true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, extfidir: "dl", hand: "RIGHT", mode: "local", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, extfidir: "dr", hand: "LEFT", mode: "local", shift:true } );
        this.newGesture( { type: "gesture", start: 0, attackPeak: 0.1, relax:0.2, end: 0.3, handConstellation: true, hand: "right", srcContact: "2_mid_palmar", secondSrcContact: "2_pad_palmar", dstContact:"hand_ulnar" } );

        this.update( 0.15 );
        this.left.loc.def.copy( this.left.locUpdatePoint ); // hack
        this.right.loc.def.copy( this.right.locUpdatePoint ); // hack
        this.update( 1 );
    }

    setDominantHand( isRightHandDominant ){
        if( isRightHandDominant ){ this.dominant = this.right; this.nonDominant = this.left; }
        else{ this.dominant = this.left; this.nonDominant = this.right; }
    }

    _updateLocationMotions( dt, arm ){
        let computeFlag = false;

        let motions = arm.locMotions;
        let resultOffset = arm.locUpdatePoint;
        resultOffset.set(0,0,0);

        // check if any motion is active and update it
        for ( let i = 0; i < motions.length; ++i ){
            if ( motions[i].transition ){
                computeFlag = true;
                resultOffset.add( motions[i].update( dt ) );
            }else{
                motions.splice(i, 1); // removed motion that has already ended
                i--;
            }
        }
        return computeFlag; 
    }

    _updateArm( dt, arm ){
        let bones = this.skeleton.bones;

        // reset shoulder, arm, elbow. This way location body, motion and location hand can be safely computed
        bones[ arm.loc.idx.shoulder ].quaternion.set(0,0,0,1);
        bones[ arm.loc.idx.arm ].quaternion.set(0,0,0,1);
        bones[ arm.loc.idx.elbow ].quaternion.set(0,0,0,1);

        // overwrite finger rotations
        arm.fingerplay.update(dt); // motion, prepare offsets
        arm.handshape.update( dt, arm.fingerplay.transition ? arm.fingerplay.curBends : null );
      
        // wrist point and twist
        arm.extfidirPalmor.update(dt);

        // wristmotion. ADD rotation to wrist
        arm.wristMotion.update(dt); // wrist - add rotation

        // backup the current wrist quaternion, before any arm rotation is applied
        arm._tempWristQuat.copy( arm.extfidirPalmor.wristBone.quaternion );

        // update arm posture world positions but do not commit results to the bones, yet.
        arm.loc.update( dt );
        let motionsRequireUpdated = this._updateLocationMotions( dt, arm );

        arm.elbowRaise.update( dt );
        arm.shoulderRaise.update( dt );
        arm.shoulderHunch.update( dt );

        arm.needsUpdate = motionsRequireUpdated | arm.fingerplay.transition | arm.handshape.transition | arm.wristMotion.transition | arm.extfidirPalmor.transition | arm.loc.transition | arm.elbowRaise.transition | arm.shoulderRaise.transition | arm.shoulderHunch.transition;
    }

    update( dt ){
        if ( !this.bodyMovement.transition && !this.right.needsUpdate && !this.left.needsUpdate && !this.handConstellation.transition ){ return; }

        this.bodyMovement.forceBindPose();

        this._updateArm( dt, this.right );
        this._updateArm( dt, this.left );
        
        if ( this.handConstellation.transition ){ 
            // 2 iks, one for body positioning and a second for hand constellation + motion
            // if only points in hand were used in handConstellation, the first ik could be removed. But forearm-elbow-upperarm locations require 2 iks

            // compute locBody and fix wrist quaternion (forearm twist correction should not be required. Disable it and do less computations)
            // using loc.cur.p, without the loc.cur.offset. Compute handConstellation with raw locBody
            this.right.ikSolver.reachTarget( this.right.loc.cur.p, this.right.elbowRaise.curValue, this.right.shoulderRaise.curValue, this.right.shoulderHunch.curValue, false ); //ik without aesthetics. Aesthetics might modify 
            this.left.ikSolver.reachTarget( this.left.loc.cur.p, this.left.elbowRaise.curValue, this.left.shoulderRaise.curValue, this.left.shoulderHunch.curValue, false );
            this._fixArmQuats( this.right, false );
            this._fixArmQuats( this.left, false );

            // handconstellation update, add motions and ik
            this.handConstellation.update( dt );
            this.right.locUpdatePoint.add( this.handConstellation.curOffsetR ); // HandConstellation + motions
            this.left.locUpdatePoint.add( this.handConstellation.curOffsetL ); // HandConstellation + motions
        }

        // if only location body and motions. Do only 1 ik per arm
        this.right.locUpdatePoint.add( this.right.loc.cur.p );
        this.right.locUpdatePoint.add( this.right.loc.cur.offset );
        this.right.ikSolver.reachTarget( this.right.locUpdatePoint, this.right.elbowRaise.curValue, this.right.shoulderRaise.curValue, this.right.shoulderHunch.curValue, true ); // ik + aesthetics

        this.left.locUpdatePoint.add( this.left.loc.cur.p );
        this.left.locUpdatePoint.add( this.left.loc.cur.offset );
        this.left.ikSolver.reachTarget( this.left.locUpdatePoint, this.left.elbowRaise.curValue, this.left.shoulderRaise.curValue, this.left.shoulderHunch.curValue, true ); // ik + aesthetics
    
        this._fixArmQuats( this.right, true );   
        this._fixArmQuats( this.left, true );  
        
        this.bodyMovement.update( dt );
    }


    /* TODO
        do not take into account bind quats
        Upperarm twist correction, forearm twist correction, wrist correction
    */
    _fixArmQuats( arm, fixForearm = false ){
        let q0 = this._tempQ_0;
        let q1 = this._tempQ_1;
        let bones = this.skeleton.bones;
        let fa = arm.extfidirPalmor.twistAxisForearm;       // forearm axis
        let fq = arm.extfidirPalmor.forearmBone.quaternion; // forearm quat
        let wa = arm.extfidirPalmor.twistAxisWrist;         // wrist axis
        let wq = arm.extfidirPalmor.wristBone.quaternion;   // wrist quat

        // --- Wrist ---
        // wrist did not know about arm quaternions. Compensate them
        q0.copy( bones[ arm.loc.idx.shoulder ].quaternion );
        q0.multiply( bones[ arm.loc.idx.arm ].quaternion );
        q0.multiply( bones[ arm.loc.idx.elbow ].quaternion );
        q0.invert();
        wq.copy( arm._tempWristQuat ).premultiply( q0 );  
        
        if ( !fixForearm ){ return } // whether to correct forearm twisting also

        // --- Forearm ---       
        let poseV = this._tempV3_0;   
        poseV.copy( arm.extfidirPalmor.elevationAxis );
        getTwistQuaternion( wq, wa, q0 );
        poseV.applyQuaternion( q0 ); // add current twisting
        getTwistQuaternion( arm.ikSolver.bindQuats.wrist, wa, q0 );
        poseV.applyQuaternion( q0.invert() ); // do not take into account possible bind twisting (could be removed if avatar is ensured to not have any twist in bind)

        // get angle, angle sign and ajust edge cases
        let angle = Math.acos( poseV.dot( arm.extfidirPalmor.elevationAxis ) );
        this._tempV3_1.crossVectors( arm.extfidirPalmor.elevationAxis, poseV );
        if ( this._tempV3_1.dot( arm.extfidirPalmor.twistAxisWrist ) < 0 ){ angle *= -1; }
        if ( arm == this.right && angle < -2.61 ){ angle = Math.PI*2 + angle; } // < -150
        if ( arm == this.left && angle > 2.61 ){ angle = -Math.PI*2 + angle; } // > 150
        
        // do not apply all twist to forearm as it may look bad on the elbow (assuming one-bone forearm)
        angle *= this.foreArmFactor;
        q0.setFromAxisAngle( fa, angle );
        fq.multiply( q0 ); // forearm
        wq.premultiply( q0.invert() ); // wrist did not know about this twist, undo it
    }

    _newGestureArm( bml, arm, symmetry = 0x00 ){
        if ( bml.locationBodyArm ){ // when location change, cut directed and circular motions
            // this.bodyMovement.forceBindPose();
            arm.loc.newGestureBML( bml, symmetry, arm.locUpdatePoint );
            arm.locMotions = [];
            this.handConstellation.cancelArm( arm == this.right ? 'R' : 'L' );
            // this.bodyMovement.forceLastFramePose();
        }
        if ( bml.motion ){
            let m = null;
            let str = typeof( bml.motion ) == "string" ? bml.motion.toUpperCase() : "";
            if ( str == "FINGERPLAY"){ m = arm.fingerplay; }
            else if ( str == "WRIST"){ m = arm.wristMotion; }
            else if ( str == "DIRECTED"){ m = new DirectedMotion(); arm.locMotions.push(m); }
            else if ( str == "CIRCULAR"){ m = new CircularMotion(); arm.locMotions.push(m); }
            
            if( m ){ 
                m.newGestureBML( bml, symmetry );
            }
        }
        if ( bml.palmor || bml.extfidir ){
            arm.extfidirPalmor.newGestureBML( bml, symmetry );
        }
        if ( bml.handshape ){
            arm.handshape.newGestureBML( bml, symmetry );
        } 
        if ( bml.hasOwnProperty( "shoulderRaise" ) ){
            arm.shoulderRaise.newGestureBML( bml, symmetry );
        }
        if ( bml.hasOwnProperty( "shoulderHunch" ) ){
            arm.shoulderHunch.newGestureBML( bml, symmetry );
        }
        if ( bml.hasOwnProperty( "elbowRaise" ) ){
            arm.elbowRaise.newGestureBML( bml, symmetry );
        }

        arm.needsUpdate = true;
    }

    /**
    * lrSym: (optional) bool - perform a symmetric movement. Symmetry will be applied to non-dominant hand only
    * udSym: (optional) bool - perform a symmetric movement. Symmetry will be applied to non-dominant hand only
    * ioSym: (optional) bool - perform a symmetric movement. Symmetry will be applied to non-dominant hand only
    * hand: (optional) "RIGHT", "LEFT", "BOTH". Default right
    * shift: (optional) bool - make this the default position. Motions not affected
    */
    newGesture( bml ){

        bml.start = bml.start || 0;
        bml.end = bml.end || bml.relax || bml.attackPeak || (bml.start + 1);
        bml.attackPeak = bml.attackPeak || ( ( bml.end - bml.start ) * 0.25 + bml.start );
        bml.relax = bml.relax || ( (bml.end - bml.attackPeak) * 0.5 + bml.attackPeak );

        // symmetry: bit0 = lr, bit1 = ud, bit2 = io
        let symmetryFlags = ( !!bml.lrSym );
        symmetryFlags |= ( ( !!bml.udSym ) << 1 );
        symmetryFlags |= ( ( !!bml.ioSym ) << 2 );

        if ( typeof( bml.hand ) == "string" ){ bml.hand = bml.hand.toUpperCase(); }
        
        if ( bml.config ){
            let c = bml.config;
            if ( c.dominant ){ this.setDominantHand( c.dominant == "RIGHT" ); }
            if ( c.handshapeBendRange ){ 
                this.left.handshape.setBendRange( handshapeBendRange );
                this.right.handshape.setBendRange( handshapeBendRange );
            }
            //...
        }

        if ( bml.handConstellation ){
            this.handConstellation.newGestureBML( bml, this.dominant == this.right ? 'R' : 'L' );
        }

        if ( bml.bodyMovement ){
            this.bodyMovement.newGestureBML( bml );
        }

        switch ( bml.hand ){
            case "RIGHT" :             
                this._newGestureArm( bml, this.right, ( this.dominant == this.right ) ? 0x00 : symmetryFlags ); 
                break;
            case "LEFT" : 
                this._newGestureArm( bml, this.left, ( this.dominant == this.left ) ? 0x00 : symmetryFlags ); 
                break;
            case "BOTH" : 
                this._newGestureArm( bml, this.dominant, 0x00 ); 
                this._newGestureArm( bml, this.nonDominant, symmetryFlags ); 
                break;
            case "NON_DOMINANT" : 
                this._newGestureArm( bml, this.nonDominant, symmetryFlags ); 
                break;
            case "DOMINANT": 
            default:
                this._newGestureArm( bml, this.dominant, 0x00 ); 
                break;
        }

    }


}



class GeometricArmIK{
    constructor( skeleton, config, isLeftHand = false ){
        this._tempM4_0 = new THREE.Matrix4();
        this._tempM3_0 = new THREE.Matrix3();
        this._tempQ_0 = new THREE.Quaternion();
        this._tempQ_1 = new THREE.Quaternion();
        this._tempQ_2 = new THREE.Quaternion();
        this._tempV3_0 = new THREE.Vector3();
        this._tempV3_1 = new THREE.Vector3();
        this._tempV3_2 = new THREE.Vector3();

        this.skeleton = skeleton;
        this.config = config;
        this.isLeftHand = !!isLeftHand;

        let handName = isLeftHand ? "L" : "R";

        this.shoulderBone = this.skeleton.bones[ this.config.boneMap[ handName + "Shoulder" ] ];
        this.armBone = this.skeleton.bones[ this.config.boneMap[ handName + "Arm" ] ];
        this.elbowBone = this.skeleton.bones[ this.config.boneMap[ handName + "Elbow" ] ];
        this.wristBone = this.skeleton.bones[ this.config.boneMap[ handName + "Wrist" ] ];

        this.bindQuats = {
            shoulder: new THREE.Quaternion(), 
            arm: new THREE.Quaternion(),
            elbow: new THREE.Quaternion(),
            wrist: new THREE.Quaternion(),
        }
        this.beforeBindAxes = {
            shoulderRaise: new THREE.Vector3(),
            shoulderHunch: new THREE.Vector3(),
            armTwist: new THREE.Vector3(), // this will also be the elevation axis
            armFront: new THREE.Vector3(),
            armBearing: new THREE.Vector3(),
            elbow: new THREE.Vector3()
        }

        // shoulder
        let boneIdx = this.config.boneMap[ handName + "Shoulder" ];
        getBindQuaternion( this.skeleton, boneIdx, this.bindQuats.shoulder );
        let m3 = this._tempM3_0.setFromMatrix4( this.skeleton.boneInverses[ boneIdx ] );
        this._tempV3_0.copy( this.config.axes[2] ).applyMatrix3( m3 ).normalize(); // convert front axis from mesh coords to local coord
        this.beforeBindAxes.shoulderHunch.crossVectors( this.skeleton.bones[ boneIdx + 1 ].position, this._tempV3_0 ).normalize(); 
        this.beforeBindAxes.shoulderRaise.crossVectors( this.skeleton.bones[ boneIdx + 1 ].position, this.beforeBindAxes.shoulderHunch ).multiplyScalar( isLeftHand ? -1: 1 ).normalize(); 

        // arm
        boneIdx = this.config.boneMap[ handName + "Arm" ];
        getBindQuaternion( this.skeleton, boneIdx, this.bindQuats.arm );
        m3.setFromMatrix4( this.skeleton.boneInverses[ boneIdx ] );
        this._tempV3_0.copy( this.config.axes[2] ).applyMatrix3( m3 ).normalize(); // convert mesh front axis to local coord
        this.beforeBindAxes.armTwist.copy( this.skeleton.bones[ boneIdx + 1 ].position ).normalize();
        this.beforeBindAxes.armBearing.crossVectors( this.beforeBindAxes.armTwist, this._tempV3_0 ).normalize(); 
        this.beforeBindAxes.armFront.crossVectors( this.beforeBindAxes.armBearing, this.beforeBindAxes.armTwist ).normalize();
        
        // elbow
        boneIdx = this.config.boneMap[ handName + "Elbow" ];
        getBindQuaternion( this.skeleton, boneIdx, this.bindQuats.elbow );
        m3.setFromMatrix4( this.skeleton.boneInverses[ boneIdx ] );
        this._tempV3_0.addVectors( this.config.axes[2], this.config.axes[1] ).applyMatrix3( m3 ).normalize(); // convert mesh front axis to local coord
        this.beforeBindAxes.elbow.crossVectors( this.skeleton.bones[ boneIdx + 1 ].position, this._tempV3_0 ).normalize();
        
        // wrist
        getBindQuaternion( this.skeleton, this.config.boneMap[ handName + "Wrist" ], this.bindQuats.wrist );

        // put in tpose
        this.shoulderBone.quaternion.copy( this.bindQuats.shoulder );
        this.armBone.quaternion.copy( this.bindQuats.arm );
        this.elbowBone.quaternion.copy( this.bindQuats.elbow );

        this.armBone.getWorldPosition( this._tempV3_0 ); // getWorldPosition updates matrices
        this.elbowBone.getWorldPosition( this._tempV3_1 );
        this.wristBone.getWorldPosition( this._tempV3_2 );        
        let v = new THREE.Vector3();
        this.armWorldSize = v.subVectors( this._tempV3_2, this._tempV3_0 ).length(); // not the same as upperarm + forearm as these bones may not be completely straight due to rigging reasons
        this.upperarmWSize = v.subVectors( this._tempV3_1, this._tempV3_0 ).length();
        this.forearmWSize = v.subVectors( this._tempV3_2, this._tempV3_1 ).length();
    }
    
    reachTarget( targetWorldPoint, forcedElbowRaiseDelta = 0, forcedShoulderRaise = 0, forcedShoulderHunch = 0, armTwistCorrection = true ){
        let wristBone = this.wristBone;
        let elbowBone = this.elbowBone;
        let armBone = this.armBone;
        let shoulderBone = this.shoulderBone;

        // set tpose quaternions, so regardless of skeleton base pose (no rotations), every avatar starts at the same pose
        shoulderBone.quaternion.copy( this.bindQuats.shoulder );
        armBone.quaternion.copy( this.bindQuats.arm );
        elbowBone.quaternion.copy( this.bindQuats.elbow );
        wristBone.updateWorldMatrix( true, false );

        let armWPos = (new THREE.Vector3()).setFromMatrixPosition( armBone.matrixWorld );     
        
        // projection of line armBone-targetPoint onto the main avatar axes (from shoulderUnion bone), normalized by the world arm length
        let targetWorldProj = new THREE.Vector3(); 
        this._tempM4_0.multiplyMatrices( this.skeleton.bones[ this.config.boneMap.ShouldersUnion ].matrixWorld, this.skeleton.boneInverses[ this.config.boneMap.ShouldersUnion ] ); // mesh to world coordinates
        let meshToWMat3 = this._tempM3_0.setFromMatrix4( this._tempM4_0 );
        this._tempV3_0.subVectors( targetWorldPoint, armWPos );
        this._tempV3_1.copy( this.config.axes[0] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.x = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        this._tempV3_1.copy( this.config.axes[1] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.y = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        this._tempV3_1.copy( this.config.axes[2] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.z = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        if ( targetWorldProj.lengthSq() > 1 ){ targetWorldProj.normalize(); }// if target is beyond arm length, set projection length to 1 

        /** Shoulder Raise and Hunch */
        let shoulderHunchFactor = targetWorldProj.x * ( this.isLeftHand ? -1 : 1 );
        let shoulderRaiseFactor = targetWorldProj.y;   
        shoulderRaiseFactor = Math.max( -1, Math.min( 1, shoulderRaiseFactor * shoulderRaiseFactor * Math.sign( shoulderRaiseFactor ) ) );
        shoulderHunchFactor = Math.max( -1, Math.min( 1, shoulderHunchFactor * shoulderHunchFactor * Math.sign( shoulderHunchFactor ) ) );
        
        let shoulderRaiseAngle = forcedShoulderRaise + this.config.shoulderRaise[0]; 
        if ( shoulderRaiseFactor < 0 ){ shoulderRaiseAngle += this.config.shoulderRaise[1] * (-1) * shoulderRaiseFactor; }
        else { shoulderRaiseAngle += this.config.shoulderRaise[2] * shoulderRaiseFactor; }            
        this._tempQ_0.setFromAxisAngle( this.beforeBindAxes.shoulderRaise, shoulderRaiseAngle );

        let shoulderHunchAngle = forcedShoulderHunch + this.config.shoulderHunch[0];
        if ( shoulderHunchFactor < 0 ){ shoulderHunchAngle += this.config.shoulderHunch[1] * (-1) * shoulderHunchFactor; }
        else { shoulderHunchAngle += this.config.shoulderHunch[2] * shoulderHunchFactor; }            
        this._tempQ_1.setFromAxisAngle( this.beforeBindAxes.shoulderHunch,  shoulderHunchAngle );

        let shoulderRot = this._tempQ_1.multiply( this._tempQ_0 );
        shoulderBone.quaternion.multiply( shoulderRot );
        armBone.quaternion.premultiply( shoulderRot.invert() ); // needed so the elbow raise behaves more intuitively

        // prepare variables for elbow
        wristBone.updateWorldMatrix( true, false ); // TODO should be only wrist, elbow, arm, shoulder
        armWPos.setFromMatrixPosition( armBone.matrixWorld ); // update arm position 

        // recompute projection. armWPos might have moved due to shoulder
        this._tempV3_0.subVectors( targetWorldPoint, armWPos );
        this._tempV3_1.copy( this.config.axes[0] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.x = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        this._tempV3_1.copy( this.config.axes[1] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.y = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        this._tempV3_1.copy( this.config.axes[2] ).applyMatrix3( meshToWMat3 ).normalize();
        targetWorldProj.z = this._tempV3_1.dot( this._tempV3_0 ) / this.armWorldSize;
        if ( targetWorldProj.lengthSq() > 1 ){ targetWorldProj.normalize(); }// if target is beyond arm length, set projection length to 1 

        let wristArmAxis = this._tempV3_2;
        let elbowRaiseQuat = this._tempQ_1;
        let armElevationBearingQuat = this._tempQ_2;

        /** Elbow */
        // Law of cosines   c^2 = a^2 + b^2 - 2ab * Cos(C)
        this._tempV3_0.subVectors( targetWorldPoint, armWPos );
        let a = this.forearmWSize; let b = this.upperarmWSize; let cc = this._tempV3_0.lengthSq(); 
        let elbowAngle = Math.acos( Math.max( -1, Math.min( 1, ( cc - a*a - b*b ) / ( -2 * a * b ) ) ) );
        elbowAngle =  Math.min( Math.PI, Math.max( 0.349, elbowAngle ) ); // limit elbow bend   Math.min( 180 * Math.PI/180, Math.max( 20 * Math.PI / 180, elbowAngle ) );
        cc = this.armWorldSize * this.armWorldSize;
        let misalignmentAngle = Math.acos( Math.max( -1, Math.min( 1, ( cc - a*a - b*b ) / ( -2 * a * b ) ) ) ); // angle from forearm-upperarm tpose misalignment
        this._tempQ_0.setFromAxisAngle( this.beforeBindAxes.elbow, misalignmentAngle - elbowAngle ); // ( Math.PI - elbowAngle ) - ( Math.PI - misalignmentAngle )
        elbowBone.quaternion.multiply( this._tempQ_0 )
        
        elbowBone.updateMatrix();
        wristArmAxis.copy( wristBone.position ).applyMatrix4( elbowBone.matrix ).normalize(); // axis in "before bind" space

        /** Arm Computation */       
        // assuming T-pose. Move from T-Pose to arms facing forward, without any twisting.
        // the 0º bearing, 0º elevation angles correspond to the armFront axis 
        let sourceProj = { x: this.beforeBindAxes.armTwist.dot( wristArmAxis ), y: this.beforeBindAxes.armBearing.dot( wristArmAxis ), z: this.beforeBindAxes.armFront.dot( wristArmAxis ) };
        let sourceAngles = { elevation: Math.asin( sourceProj.y ), bearing: Math.atan2( -sourceProj.x, sourceProj.z ) };        
        armElevationBearingQuat.set(0,0,0,1);
        this._tempQ_0.setFromAxisAngle( this.beforeBindAxes.armBearing, - sourceAngles.bearing );
        armElevationBearingQuat.premultiply( this._tempQ_0 );
        this._tempQ_0.setFromAxisAngle( this.beforeBindAxes.armTwist, - sourceAngles.elevation );
        armElevationBearingQuat.premultiply( this._tempQ_0 );

        // move to target
        armBone.updateWorldMatrix( false, false ); // only update required is for the arm
        let wToLArm = this._tempM4_0.copy( this.armBone.matrixWorld ).invert(); // world to local
        let targetLocalDir = this._tempV3_0.copy( targetWorldPoint ).applyMatrix4( wToLArm ).normalize();
        let rotAxis = this._tempV3_1.crossVectors( this.beforeBindAxes.armFront, targetLocalDir ).normalize();
        this._tempQ_0.setFromAxisAngle( rotAxis, this.beforeBindAxes.armFront.angleTo( targetLocalDir ) );
        armElevationBearingQuat.premultiply( this._tempQ_0 );

        /** ElbowRaise Computation */
        let elbowRaiseAngle = -1.5* ( 1 - elbowAngle / Math.PI ); 
        elbowRaiseAngle += Math.PI * 0.1 * Math.max( 0, Math.min( 1, targetWorldProj.x * 2 * (this.isLeftHand?-1:1)) );  // x / 0.5
        elbowRaiseAngle += Math.PI * 0.1 * Math.max( 0, Math.min( 1, targetWorldProj.y * 2 ) ); // y / 0.5
        elbowRaiseAngle += Math.PI * 0.2 * Math.max( 0, Math.min( 1, -targetWorldProj.z * 5 ) ); // z / 0.2
        elbowRaiseAngle += forcedElbowRaiseDelta + this.config.elbowRaise;
        elbowRaiseAngle *= ( this.isLeftHand ? 1 : -1 ); // due to how axis is computed, angle for right arm is inverted
        elbowRaiseQuat.setFromAxisAngle( wristArmAxis, elbowRaiseAngle );
        
        /** Arm and ElbowRaise apply */
        armBone.quaternion.multiply( armElevationBearingQuat );
        armBone.quaternion.multiply( elbowRaiseQuat ); // elbowraiseQuat is computed in before bind before arm movement space
        if ( armTwistCorrection ) this._correctArmTwist();

    }

    // remove arm twisting and insert it into elbow. Just for aesthetics
    _correctArmTwist(){
        // remove arm twisting and insert it into elbow
        // (quaternions) R = S * T ---> T = normalize( [ Wr, proj(Vr) ] ) where proj(Vr) projection into some arbitrary twist axis
        let twistq = this._tempQ_0;
        let armQuat = this._tempQ_1.copy( this.bindQuats.arm ).invert().multiply( this.armBone.quaternion ); // armbone = ( bind * armMovement ). Do not take into account bind
        let twistAxis = this._tempV3_0.copy( this.elbowBone.position ).normalize();
        getTwistQuaternion( armQuat, twistAxis, twistq );
        this.elbowBone.quaternion.premultiply( twistq );
        this.armBone.quaternion.multiply( twistq.invert() );

        // // previous fix might induce some twisting in forearm. remove forearm twisting. Keep only swing rotation
        armQuat = this._tempQ_1.copy( this.bindQuats.elbow ).invert().multiply( this.elbowBone.quaternion ); // elbowBone = ( bind * armMovement ). Do not take into account bind
        twistAxis = this._tempV3_0.copy( this.wristBone.position ).normalize();
        getTwistQuaternion( armQuat, twistAxis, twistq );
        this.elbowBone.quaternion.multiply( twistq.invert() );
    }
}

// sigmlStringToBML translate from a sigml (xml) string (valid in jasigning) to a bml. It is an approximate solution.

// missing location_hand (and handconstellation)
// missing rpt_motion
// non manual features parser system already implemented. Missing several non manual features tables 


/* 

AFPAKKEN
AANPASSEN
AANTAL
BABYSITTEN
AARDAPPELPUREE
*/


const TIMESLOT ={
    DEF: 0.5,

    NMFSTARTPEAK: 0.25,
    NMFWAIT: 0.25,
    NMFRELAXEND: 0.25,

    POSTURE: 0.3,
    LOC: 0.3,
    HAND: 0.3,

    MOTION: 0.5,
    MOTIONDIR : 0.3,
    MOTIONCIRC : 0.5,
    MOTIONFINGERPLAY : 0.8,
    MOTIONWRIST : 0.8,

    REST: 0.3, // rest attributes of some motions
    RELAXEND: 0.5, // after the sign, the time it takes to return to neutral pose
    PEAKRELAX: 0.5, // after the last posture is executed, the time it stays in that pose (instead of moving the arm and immediately returning to neutral pose)
}

window.TIMESLOTS = TIMESLOT;


function sigmlStringToBML( str, timeOffset = 0 ) {
    let parser = new DOMParser();
    let xmlDoc = null;

    let msg = [];
    timeOffset = (isNaN(timeOffset)) ? 0 : timeOffset;
    let time = timeOffset;
    try{
        xmlDoc = parser.parseFromString( str, "text/xml" ).children[0];
    }catch( error ){
        return { data: [], duration: 0, relaxEndDuration: 0 };
    }

    let lastRelaxEndDuration = 0
    let lastPeakRelaxDuration = 0;
    let isFirstValidSign = true;
    // for each hamnosis sign
    for( let i = 0; i < xmlDoc.children.length ; ++i ){
        if( xmlDoc.children[i].tagName != "hns_sign" && xmlDoc.children[i].tagName != "hamgestural_sign" ){ continue; }
        
        time = time - lastRelaxEndDuration - lastPeakRelaxDuration + 0.2; // if not last, remove relax-end stage and partially remove the peak-relax 
        if( isFirstValidSign ){ time -= 0.2; }
        let result = hnsSignParser( xmlDoc.children[i], time );
        time = result.end;
        msg = msg.concat( result.data );
        lastRelaxEndDuration = result.relaxEndDuration;
        lastPeakRelaxDuration = result.peakRelaxDuration;
    }

    return { data: msg, duration: ( time - timeOffset ), relaxEndDuration: lastRelaxEndDuration, peakRelaxDuration: lastPeakRelaxDuration };
}


function hnsSignParser( xml, start ){
    let result = [];
    let end = start;
    let relaxEndDuration = 0;
    let peakRelaxDuration = 0;

    // parse xml attributes
    let attributes = {}
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }
    let signSpeed = parseFloat( attributes.speed ); 
    signSpeed = ( isNaN( signSpeed ) ) ? 1 : signSpeed;

    let resultManual = null;
    let resultNonManual = null;
    for ( let i = 0; i < xml.children.length; ++i ){
        if ( !resultNonManual && xml.children[i].tagName == "sign_nonmanual" ){
            resultNonManual = signNonManual( xml.children[i], start, signSpeed );
            if (end < resultNonManual.end ){ end = resultNonManual.end; }
        }
        if ( !resultManual && xml.children[i].tagName == "sign_manual" ){
            resultManual = signManual( xml.children[i], start, signSpeed );
            peakRelaxDuration = resultManual.peakRelaxDuration;
            relaxEndDuration = resultManual.relaxEndDuration;
            if (end < resultManual.end ){ end = resultManual.end; }

        }
    }

    if ( resultManual ){ result = result.concat( resultManual.data ); }
    if ( resultNonManual ){ result = result.concat( resultNonManual.data ); }
    if ( attributes.gloss ){ result.unshift( { gloss: attributes.gloss } ); }
    
    return { data: result, end: end, relaxEndDuration: relaxEndDuration, peakRelaxDuration: peakRelaxDuration }; 
}


// ###############################################
// #                Manual Parser                #
// ###############################################


let simpleMotionAvailable = [ "directedmotion", "circularmotion", "wristmotion", "crossmotion", "fingerplay", "changeposture", "nomotion" ]; // crossmotion deprecated
let motionsAvailable = simpleMotionAvailable.concat( [ "nonman_motion", "par_motion", "seq_motion", "split_motion", "rpt_motion", "tgt_motion" ] ); // missing tgt, rpt and timing issues
let posturesAvailable = [ "handconfig", "split_handconfig", "location_bodyarm", "split_location", "location_hand", "handconstellation" , "use_locname"]; // missing location_hand, handconstellation, use_locname(????) 

if (typeof(stringToDirection) != 'function') {
    // used in rpt_motion
    function stringToDirection( str, outV = null, symmetry = 0x00 ){
        if ( !outV ){ outV = [0,0,0]; }
        outV.fill(0);
        if ( typeof( str ) != "string" ){ return outV; }

        str = str.toUpperCase();
        
        // right hand system. If accumulate, count repetitions
        outV[0] = str.split("L").length - str.split("R").length; 
        outV[1] = str.split("U").length - str.split("D").length;
        outV[2] = str.split("O").length - str.split("I").length;
    
        if ( symmetry & 0x01 ){ outV[0] *= -1; }
        if ( symmetry & 0x02 ){ outV[1] *= -1; }
        if ( symmetry & 0x04 ){ outV[2] *= -1; }

        let length = Math.sqrt( outV[0] * outV[0] + outV[1] * outV[1] + outV[2] * outV[2] );
        
        if ( length < 0.0001 ){ outV.fill(0); }
        outV[0] /= length;
        outV[1] /= length;
        outV[2] /= length;
        return outV;
    }
}


function checkHandsUsage( orders ){
    
    let hand = "RIGHT";
    let result = {};

    while( true ){
        let handResult = {
            isHandUsed: false,
            firstHandUsage: 9999999999999,
            firstLocationBody: 9999999999999,
            usage: [ false, false, false, false ], // location, extfidir, palmor, handshape
        };
        if ( !orders ){ orders = []; }
      
        for ( let i = 0; i < orders.length; ++i ){
            if ( orders[i].hand != "BOTH" && orders[i].hand != hand ){ continue; }
            handResult.isHandUsed = true;
            let o = orders[i];
            if ( o.start < handResult.firstHandUsage && !o.locationBodyArm ){ handResult.firstHandUsage = o.start; }
            if ( o.start < handResult.firstLocationBody && o.locationBodyArm ){ handResult.firstLocationBody = o.start; }

            if ( o.locationBodyArm || o.handConstellation ){ handResult.usage[0] = true; }
            if ( o.extfidir ){ handResult.usage[1] = true; }
            if ( o.palmor ){ handResult.usage[2] = true; }
            if ( o.handshape ){ handResult.usage[3] = true; }
        }

        result[ hand ] = handResult;
        if ( hand == "RIGHT" ){ hand = "LEFT"; }
        else{ break; }
    }

    return result;

}

// this function and structure is only needed because rpt_motion needs to know the src pose to witch return during repetitions
function currentPostureUpdate( oldPosture, newOrders, overwrite = false ){
    let newPosture;
    if ( !oldPosture ){
        newPosture = {
            RIGHT: [
                { type: "gesture", start: -1, locationBodyArm: "CHEST", secondLocationBodyArm: "STOMACH", hand: "RIGHT", distance: 0.37, side: "r", srcLocation: "HAND", srcSide: "PALMAR" },
                { type: "gesture", start: -1, extfidir: "dl", hand: "RIGHT" }, 
                { type: "gesture", start: -1, palmor: "l", hand: "RIGHT" }, 
                { type: "gesture", start: -1, handshape: "FLAT", thumbshape: "TOUCH", hand: "RIGHT" }, 
            ],
            LEFT: [
                { type: "gesture", start: -1, locationBodyArm: "CHEST", secondLocationBodyArm: "STOMACH", hand: "LEFT", distance: 0.37, side: "l", srcLocation: "HAND", srcSide: "PALMAR" },
                { type: "gesture", start: -1, extfidir: "dr", hand: "LEFT" }, 
                { type: "gesture", start: -1, palmor: "r", hand: "LEFT" }, 
                { type: "gesture", start: -1, handshape: "FLAT", thumbshape: "TOUCH", hand: "LEFT" }, 
            ],
            handConstellation: null,
        }
    }
    else if ( overwrite ){ newPosture = oldPosture; }
    else { newPosture = JSON.parse( JSON.stringify( oldPosture ) ); }

    // check all new orders
    let hand = "RIGHT";
    while( true ){

        for( let i = 0; i < newOrders.length; ++i ){
            let o = newOrders[i];
            let type = -1;
            if ( o.locationBodyArm ){ type = 0; }
            else if ( o.extfidir ){ type = 1; }
            else if ( o.palmor ){ type = 2; }
            else if ( o.handshape ){ type = 3; }
            else if ( o.handConstellation ){ type = 4; }
    
            // if a new order has a bigger start than the old posture, it becomes the new posture
            if( type > -1 && type < 4 ){
                if ( ( o.hand == hand || o.hand == "BOTH" ) && newPosture[ hand ][ type ].start < o.start ){
                    newPosture[ hand ][ type ] = JSON.parse( JSON.stringify( o ) ); // copy object, not reference
                    newPosture[ hand ][ type ].hand = hand;
                    delete newPosture[ hand ][ type ].attackPeak; // just in case
                    delete newPosture[ hand ][ type ].relax;
                    delete newPosture[ hand ][ type ].end;
                }
            }
            else if ( type == 4 ){
                if ( !newPosture.handConstellation || newPosture.handConstellation.start < o.start ){
                    newPosture.handConstellation = JSON.parse( JSON.stringify( o ) ); // copy object, not reference
                    delete newPosture.handConstellation.attackPeak; // just in case
                    delete newPosture.handConstellation.relax;
                    delete newPosture.handConstellation.end;
                }
    
            }
        }

        if ( hand == "RIGHT" ){ hand = "LEFT"; }
        else{ break; }
    }


    return newPosture;
}

// missing location_hand (and handconstellation), motions except simpleMotion
function signManual( xml, start, signSpeed ){
    let result = [];
    let time = start;
    let actions = xml.children;
    if ( !actions.length ){ return { data: [], end: start, peakRelaxDuration: 0, relaxEndDuration: 0 }; }

    // parse xml attributes
    let attributes = {}
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }
    
    const signGeneralInfo = {
        domHand: "RIGHT",
        nonDomHand: "LEFT",
        bothHands: false,
        symmetry: 0x00,
        outofphase: false,
    };
    signGeneralInfo.bothHands = attributes.both_hands == "true";
    if ( !signGeneralInfo.bothHands && attributes.nondominant == "true" ){ signGeneralInfo.domHand = "LEFT"; }
    signGeneralInfo.nonDomHand = signGeneralInfo.domHand == "RIGHT" ? "LEFT" : "RIGHT";
    let lrSym = attributes.lr_symm == "true";
    let oiSym = attributes.oi_symm == "true";
    let udSym = attributes.ud_symm == "true";
    signGeneralInfo.symmetry = lrSym | ( udSym << 1 ) | ( oiSym << 2 );
    signGeneralInfo.outofphase = attributes.outofphase == "true";

    let motionsStarted = false; // (JASIGNING) when motion instructions start, no handconfig or location are taken into account. Also time starts adding

    result.push( { type: "gesture", config: { dominant: signGeneralInfo.domHand } } );
    let currentPosture = currentPostureUpdate( null, [] );

    // Mode 1: several <sign_manual> inside a <sign_manual>. Modes 1 and 2 cannot coexist. Either one or the other
    if ( actions[0].tagName == "sign_manual" ){
        let peakRelaxDuration = 0;
        let relaxEndDuration = 0;
        for ( let i = 0; i < actions.length; ++i ){
            let action = actions[i];
            let tagName = actions[i].tagName;
    
            // some sigml signs have several sign_manual inside
            if ( tagName == "sign_manual" ){
                time = time - peakRelaxDuration * 0.8 - relaxEndDuration;
                let r = signManual( action, time, signSpeed );
                result = result.concat( r.data );
                peakRelaxDuration = r.peakRelaxDuration;
                relaxEndDuration = r.relaxEndDuration;
                if ( time < r.end ) { time = r.end; }
            }
        }
        return { data: result, end: time, peakRelaxDuration: peakRelaxDuration, relaxEndDuration: relaxEndDuration };

    }
    
    // Mode 2: instructions only. Modes 1 and 2 cannot coexist. Either one or the other
    for ( let i = 0; i < actions.length; ++i ){
        let action = actions[i];
        let tagName = actions[i].tagName;

        if ( !motionsStarted ){
            if ( posturesAvailable.includes( tagName ) ){
                let r = postureParser( action, time, signGeneralInfo.bothHands ? "BOTH" : signGeneralInfo.domHand, signGeneralInfo.symmetry, signSpeed, signGeneralInfo, currentPosture );
                result = result.concat( r.data );
                currentPosture = currentPostureUpdate( currentPosture, r.data ); // needed for location_hand in locatoin_bodyarm...
                // do not advance time. All postures should happen at the same time
            }
        }
        if ( motionsAvailable.includes( tagName ) ){
            if( !motionsStarted && result.length > 1 ){ 
                time += TIMESLOT.LOC / signSpeed; 
            }
            motionsStarted = true; // locations and handconfigs will no longer be accepted for this sign
            let r = motionParser( action, time, signGeneralInfo.bothHands ? "BOTH" : signGeneralInfo.domHand, signGeneralInfo.symmetry, signSpeed, signGeneralInfo, currentPosture );
            result = result.concat( r.data );
            if ( time < r.end ) { time = r.end; }
            currentPosture = currentPostureUpdate( currentPosture, r.data );
        }
    }
    // no motions were inserted, but a location was
    if ( !motionsStarted && result.length > 1 ){
        time += TIMESLOT.LOC / signSpeed; 
    }

    // add default locations if necessary ( add to the beginning of array to avoid location cancelling any handconstellation or whatever)
    let checkHandsResult = checkHandsUsage( result );
    if ( checkHandsResult["RIGHT"].isHandUsed ){
        if ( checkHandsResult["RIGHT"].firstHandUsage + 0.05 < checkHandsResult["RIGHT"].firstLocationBody ){ 
            result.unshift( { type: "gesture",  start:start - 0.0001, attackPeak:start + TIMESLOT.LOC / signSpeed, locationBodyArm: "CHEST", secondLocationBodyArm: "STOMACH", hand: "RIGHT", distance: 0.37, side: "r", srcLocation: "HAND", srcSide: "PALMAR"  } );
        }
    }
    if ( checkHandsResult["LEFT"].isHandUsed ){
        if ( checkHandsResult["LEFT"].firstHandUsage + 0.05 < checkHandsResult["LEFT"].firstLocationBody ){ 
            result.unshift( { type: "gesture",  start:start - 0.0001, attackPeak:start + TIMESLOT.LOC / signSpeed, locationBodyArm: "CHEST", secondLocationBodyArm: "STOMACH", hand: "LEFT", distance: 0.37, side: "l", srcLocation: "HAND", srcSide: "PALMAR"  } );
        }
    }


    let peakRelaxDuration = TIMESLOT.PEAKRELAX; //TIMESLOT.PEAKRELAX / signSpeed; // add an extra time for all ending instrunctions' attackPeak-realx stage
    time += peakRelaxDuration;

    // these actions should last for the entirety of the sign. If there is a change mid sign, the new will overwrite the previous, so no problem with conflicting ends 
    for ( let i = 0; i < result.length; ++i ){
        if ( result[i].extfidir || result[i].palmor || result[i].handshape || result[i].locationBodyArm || result[i].handConstellation ){ 
            if ( isNaN( result[i].relax ) ){ result[i].relax = time; }
            if ( isNaN( result[i].end ) ){ result[i].end = time + TIMESLOT.RELAXEND; } //TIMESLOT.RELAXEND / signSpeed; }
        }
        if ( result[i].motion == "DIRECTED" || result[i].motion == "CIRCULAR" ){ // circular mainly when it is not a 2*PI rotation  
            // result[i].attackPeak = result[i].start + TIMESLOT.MOTIONDIR;
            if ( isNaN( result[i].relax ) ){ result[i].relax = time; }
            if ( isNaN( result[i].end ) ){ result[i].end = time + TIMESLOT.RELAXEND; } //TIMESLOT.RELAXEND / signSpeed; }
        }
        if ( result[i].motion == "WRIST" || result[i].motion == "FINGERPLAY" ){ 
            let dt = 0.15 * ( result[i].end - result[i].start );
            result[i].attackPeak = result[i].start + ( ( dt < 0.15 ) ? dt : 0.15 ); // entry not higher than 150 ms
            if ( isNaN( result[i].relax ) ){ result[i].relax = result[i].end - ( ( dt < 0.15 ) ? dt : 0.15 ); }
        }
    }

    let relaxEndDuration = TIMESLOT.RELAXEND;// TIMESLOT.RELAXEND / signSpeed; // add an extra time for all ending instructions relax-end
    time += relaxEndDuration;

    
    return { data: result, end: time, peakRelaxDuration: peakRelaxDuration, relaxEndDuration: relaxEndDuration };
}

function postureParser( xml, start, hand, symmetry, signSpeed, signGeneralInfo, currentPosture = null ){
    // shape of pose until the end of the sign or a tgt motion
    let result = [];
    let tagName = xml.tagName;
    let maxEnd = 0;
    let time = start;

    if ( tagName == "handconfig" ){
        result = result.concat( handconfigParser( xml, time, time + TIMESLOT.HAND / signSpeed, hand, symmetry, signGeneralInfo ) );
        maxEnd = TIMESLOT.HAND / signSpeed;
    }  
    else if ( tagName == "split_handconfig" ){ // split instruction removes any symmetry. Both_hands attribute does not matter
        if ( xml.children.length > 0 && xml.children[0].tagName == "handconfig" ){
            result = result.concat( handconfigParser( xml.children[0], time, time + TIMESLOT.HAND / signSpeed, signGeneralInfo.domHand, 0x00, signGeneralInfo ) );
            maxEnd = TIMESLOT.HAND / signSpeed;
        }
        if ( xml.children.length > 1 && xml.children[1].tagName == "handconfig" ){
            result = result.concat( handconfigParser( xml.children[1], time, time + TIMESLOT.HAND / signSpeed, signGeneralInfo.nonDomHand, 0x00, signGeneralInfo ) );
            maxEnd = TIMESLOT.HAND / signSpeed;
        }
    }
    
    else if ( tagName == "location_bodyarm" ){ 
        result = result.concat( locationBodyArmParser( xml, time, time + TIMESLOT.LOC / signSpeed, hand, symmetry, signGeneralInfo, currentPosture ) );
        maxEnd = TIMESLOT.LOC / signSpeed;
    }
    else if ( tagName == "split_location" ){ // can be location_hand or location_bodyarm. // split instruction removes any symmetry.  Both_hands attribute does not matter
        // first check bodyarm locations, as these has cancel out any previous handconstellation in bml 
        if ( xml.children.length > 0 && xml.children[0].tagName == "location_bodyarm" ){
            result = result.concat( locationBodyArmParser( xml.children[0], time -0.000001, time + TIMESLOT.LOC / signSpeed, signGeneralInfo.domHand, 0x00, signGeneralInfo, currentPosture ) );
            maxEnd = TIMESLOT.LOC / signSpeed;
        }
        if ( xml.children.length > 1 && xml.children[1].tagName == "location_bodyarm" ){
            result = result.concat( locationBodyArmParser( xml.children[1], time -0.000001, time + TIMESLOT.LOC / signSpeed, signGeneralInfo.nonDomHand, 0x00, signGeneralInfo, currentPosture ) );
            maxEnd = TIMESLOT.LOC / signSpeed;
        }

        // check if there is any location hand
        let domChild = null;
        let nonDomChild = null;
        if ( xml.children.length > 0 && xml.children[0].tagName == "location_hand" ){ domChild = locationHandInfoExtract( xml.children[0], true ); }
        if ( xml.children.length > 1 && xml.children[1].tagName == "location_hand" ){ nonDomChild = locationHandInfoExtract( xml.children[1], true ); }

        if ( domChild || nonDomChild ){
            let handConstellation = { type: "gesture", start: time, attackPeak: time + TIMESLOT.LOC / signSpeed, handConstellation:"true" };

            // each location hand specifies where to touch in the OTHER hand 
            if ( domChild && nonDomChild ){ 
                handConstellation.hand = "BOTH";
                handConstellation.dstLocation = domChild.location;
                handConstellation.dstSide = domChild.side;
                handConstellation.dstFinger = domChild.finger;
                handConstellation.srcLocation = nonDomChild.location;
                handConstellation.srcSide = nonDomChild.side;
                handConstellation.srcFinger = nonDomChild.finger;
            }else{ // only one child is location_hand
                let filledChild = domChild ? domChild : nonDomChild;
                handConstellation.hand = domChild ? signGeneralInfo.domHand : signGeneralInfo.nonDomHand;

                handConstellation.dstLocation = filledChild.location;
                handConstellation.dstSide = filledChild.side;
                handConstellation.dstFinger = filledChild.finger;
                if ( filledChild.child ){
                    handConstellation.srcLocation = filledChild.child.location;
                    handConstellation.srcSide = filledChild.child.side;
                    handConstellation.srcFinger = filledChild.child.finger;
                }
            }

            result.push( handConstellation );
            maxEnd = TIMESLOT.LOC / signSpeed;
        }
    }
    else if ( tagName == "handconstellation" ){ 
        // <!ELEMENT  handconstellation  (  (location_hand, location_hand)?, location_bodyarm? )>
        result = result.concat( handConstellationParser( xml, time, time + TIMESLOT.LOC / signSpeed, hand, signGeneralInfo, currentPosture ) );
        if ( result.length > 0 ){ maxEnd = TIMESLOT.LOC / signSpeed; }

    } 
    else if ( tagName == "location_hand" ){
        result = result.concat( locationHandAsHandConstellationParser( xml, time, time + TIMESLOT.LOC / signSpeed, hand, signGeneralInfo, currentPosture ) );
        if ( result.length > 0 ){ maxEnd = TIMESLOT.LOC / signSpeed; }
    }

    return { data: result, end: ( start + maxEnd ) };
}
// in JaSigning the handconfig lasts until the end of the sign/gloss or until another instruction overwrites it
function handconfigParser( xml, start, attackPeak, hand, symmetry, signGeneralInfo ){
    let attributes = {}
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    let result = [];
    if ( attributes.handshape || attributes.thumbpos || attributes.bend1 || attributes.bend2 || attributes.bend3 || attributes.bend4 || attributes.bend5 || attributes.mainbend ){ 
        let obj = { type: "gesture", start: start, attackPeak: attackPeak, hand: hand };
        obj.handshape = attributes.handshape.toUpperCase().replace("FINGER", "FINGER_").replace("SPREAD", "_SPREAD").replace("PINCH", "PINCH_").replace("CEE", "CEE_").replace("OPEN", "_OPEN") || "FLAT";
        if ( attributes.second_handshape ){ obj.secondHandshape = attributes.second_handshape.toUpperCase().replace("FINGER", "FINGER_").replace("SPREAD", "_SPREAD").replace("PINCH", "PINCH_").replace("CEE", "CEE_").replace("OPEN", "_OPEN"); }
        if ( attributes.mainbend ) { obj.mainBend = attributes.mainbend.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.second_mainbend ) { obj.secondMainBend = attributes.second_mainbend.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.thumbpos ) { obj.thumbshape = attributes.thumbpos.toUpperCase(); }
        if ( attributes.second_thumbpos ) { obj.secondThumbshape = attributes.second_thumbpos.toUpperCase(); } 
        switch( attributes.ceeopening ){ 
            case "slack": obj.tco = 0.4; break;
            case "tight": obj.tco = -0.4; break;
            default: break;
        }
        switch( attributes.second_ceeopening ){ 
            case "slack": obj.secondtco = 0.4; break;
            case "tight": obj.secondtco = -0.4; break;
            default: break;
        }
        if ( attributes.bend1 ){ obj.bend1 = attributes.bend1.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.bend2 ){ obj.bend2 = attributes.bend2.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.bend3 ){ obj.bend3 = attributes.bend3.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.bend4 ){ obj.bend4 = attributes.bend4.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.bend5 ){ obj.bend5 = attributes.bend5.toUpperCase().replace("HALF", "HALF_").replace("DBL", "DOUBLE_"); }
        if ( attributes.specialfingers ){ obj.specialFingers = attributes.specialfingers; }

        result.push( obj );
    }
    if ( attributes.extfidir ){
        let obj = { type: "gesture", start: start, attackPeak: attackPeak, hand: hand };
        obj.extfidir = attributes.extfidir;
        if( attributes.second_extfidir ){ obj.secondExtfidir = attributes.second_extfidir; }
        if ( symmetry & 0x01 ){ obj.lrSym = true; }
        if ( symmetry & 0x02 ){ obj.udSym = true; }
        if ( symmetry & 0x04 ){ obj.oiSym = true; }
        result.push( obj );
    }
    if ( attributes.palmor ){
        let obj = { type: "gesture", start: start, attackPeak: attackPeak, hand: hand };

        if ( !attributes.palmor.match( /[l,r,u,d]/g ) ){ 
            if ( attributes.second_palmor && attributes.second_palmor.match( /[l,r,u,d]/g) ){ 
                obj.palmor = attributes.second_palmor;
            }else{
                obj.palmor = "dlll";
            }
        }else{
            obj.palmor = attributes.palmor;
            if ( attributes.second_palmor ){ obj.secondPalmor = attributes.second_palmor; }
        }

        if ( hand == "BOTH" && signGeneralInfo.bothHands ){ obj.lrSym = true; }
        else if ( symmetry & 0x01 ){ obj.lrSym = true; }  
        if ( symmetry & 0x02 ){ obj.udSym = true; }
        if ( symmetry & 0x04 ){ obj.oiSym = true; }
       
        result.push( obj );
    }
    return result;
}


let locationMapHead = {
    forehead: "FOREHEAD",
    eyebrows: "EYEBROW",
    eyes: "EYE",
    uppereyelid: "EYE",
    lowereyelid: "EYE",
    nose: "NOSE",
    nostrils: "NOSE",
    ear: "EAR",
    earlobe: "EARLOBE",
    cheek: "CHEEK",
    lips: "MOUTH",
    upperlip: "MOUTH",
    lowerlip: "MOUTH",
    tongue: "MOUTH",
    teeth: "MOUTH",
    upperteeth: "MOUTH",
    lowerteeth: "MOUTH",
    chin: "CHIN",
    underchin: "UNDER_CHIN",
}
let locationMapBody = {
    headtop: "HEAD_TOP",
    head: "HEAD", 
    neck: "NECK",
    shoulders: "SHOULDER_LINE",
    shouldertop: "SHOULDER_TOP",
    chest: "CHEST",
    stomach: "STOMACH",
    belowstomach: "BELOW_STOMACH",
}
let locationMap ={};
for( let l in locationMapHead ){ locationMap[l] = locationMapHead[l]; }
for( let l in locationMapBody ){ locationMap[l] = locationMapBody[l]; }

let locationHand_ArmTable = [ "upperarm", "elbow", "elbowinside", "lowerarm" ];
let locationHand_FingerpartTable = [ "tip", "nail", "pad", "midjoint", "base", "side" ];
let locationHand_HandpartTable = [ "wristback", "thumbball", "palm", "handback", "thumbside", "pinkyside" ];

// in JaSigning the location lasts until the end of the sign/gloss or until another instruction overwrites it
function locationBodyArmParser( xml, start, attackPeak, hand, symmetry, signGeneralInfo, currentPosture ){
    let attributes = {};
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    let result = { type: "gesture", start: start - 0.00001, attackPeak: attackPeak, hand: hand }; // -0.000001 to avoid locationBodyArm cancelling motions or handconstellations

    // usual body location
    if ( hand == "BOTH" && signGeneralInfo.bothHands ){ result.lrSym = true; }
    else if ( symmetry & 0x01 ){ result.lrSym = true; }  
    if ( symmetry & 0x02 ){ result.udSym = true; }
    if ( symmetry & 0x04 ){ result.oiSym = true; }

    if ( attributes.contact == "armextended" ){ result.distance = 0.5; }
    else if ( attributes.contact == "close" ){ result.distance = 0.3; }
    else { 
        if ( locationMapHead[ attributes.location ] ){ attributes.contact = "touch"; } // need this later for srcContact
        if ( attributes.contact == "touch" ){ result.distance = 0.0; }
        else{ result.distance = 0.4; } 
    } // jasigning has a default unmentioned distance...

    // jasigning might accept some arm locations in the body location instruction. Transform it into a handconstellation
    if ( locationHand_ArmTable.includes( attributes.location ) || locationHand_HandpartTable.includes( attributes.location ) ){
        let r = locationHandInfoExtract( xml, true );
     
        result.handConstellation = true;
        result.dstLocation = r.location;
        result.dstSide = r.side;
        if ( r.child ){
            if ( r.child.finger ){ result.srcFinger = r.child.finger; }
            if ( r.child.location ){ result.srcLocation = r.child.location; }
            if ( r.child.side ){ result.srcSide = r.child.side; }
        }
        return [ result ];
    } // ------

    result.locationBodyArm = locationMap[ attributes.location ];
    let temp = locationMap[ attributes.second_location ];
    if ( temp ){ result.secondLocationBodyArm = temp; }
    switch( attributes.side ){
        case "right_at": result.side = "r"; break;
        case "right_beside": result.side = "rr"; break;
        case "left_at": result.side = "l"; break;
        case "left_beside": result.side = "ll"; break;
        default:   
            if ( hand == "BOTH" && signGeneralInfo.bothHands ){ 
                result.side = signGeneralInfo.domHand[0].toLowerCase();
                result.lrSym = true;
            }
            break;    
    }
    switch( attributes.second_side ){
        case "right_at": result.secondSide = "r"; break;
        case "right_beside": result.secondSide = "rr"; break;
        case "left_at": result.secondSide = "l"; break;
        case "left_beside": result.secondSide = "ll"; break;
        default: 
            if ( hand == "BOTH" && signGeneralInfo.bothHands ){ 
                result.secondSide = signGeneralInfo.domHand[0].toLowerCase();
                result.lrSym = true;
            }
            break;    
    }

    let locationHand = null;
    if ( xml.children.length > 0 && xml.children[0].tagName == "location_hand" ){
        locationHand = locationHandInfoExtract( xml.children[0], false );
        if ( !( locationHand.finger || locationHand.side || locationHand.location ) ){ locationHand = null; } // go to default settings, as if no location hand was present
        else{
            if ( locationHand.location ){ result.srcLocation = locationHand.location; }
            if ( locationHand.side ){ result.srcSide = locationHand.side; }
            if ( locationHand.finger ){ result.srcFinger = locationHand.finger; }
        }
    }

    if ( !locationHand ){
        let handshape = currentPosture[ hand == signGeneralInfo.nonDomHand ? signGeneralInfo.nonDomHand : signGeneralInfo.domHand ][3].handshape;

        // when touch or specific hand in face, check if handshape is 
        let shouldBeFingerSelected = ( attributes.contact == "touch" ) || ( hand != "BOTH" && locationMapHead[ attributes.location ] );
        shouldBeFingerSelected = shouldBeFingerSelected &&  ( handshape != "FLAT" && handshape != "FIST" && handshape != "FINGER_2345" );

        if ( shouldBeFingerSelected ){
            // actually should be the selected finger but let's keep it simple for now
            result.srcFinger = "1";
            if ( handshape == "FINGER_2" || handshape == "FINGER_23" || handshape == "FINGER_23_SPREAD" || handshape == "FINGER_2345" ){
                result.srcFinger = "2";
            }
            result.srcLocation = "TIP";
        }else{
            result.srcLocation = "HAND";
            result.srcSide = "PALMAR";
        }
    }

    return [ result ];
}

function locationHandInfoExtract( xml, parseChildren = true ){
    // missins second digits, location, side
    // given how handconstellation works, the location_hand inside a location_hand means the srcLocation
    // given how handconstellation works, the location_hand inside a location_bodyArm means the srcLocation

    let attributes = {};
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    let result = {};

    let isSecond = false;
    let digit, location, side;
    
    for( let i = 0; i < 2; ++i ){
        isSecond = i == 1;
        digit = isSecond ? attributes.second_digits : attributes.digits; 
        digit = ( digit != 1 && digit != 2 && digit != 3 && digit != 4 && digit != 5 ) ? null : parseInt( digit ); // it needs to be exactly those numbers "2asdfasd" is not valid but parseInt will return 2
        location = isSecond ? attributes.second_location : attributes.location;
        side = isSecond ? attributes.second_side : attributes.side;
        
        // some fingerpart specified
        if ( digit ){
            switch( side ){
                case "right_at": 
                case "right_beside": 
                    side = "RIGHT"; 
                    break; 
                case "left_at": 
                case "left_beside": 
                    side = "LEFT"; 
                    break; 
                case "front": side = "PALMAR"; break; 
                case "dorsal": side = "BACK"; break;
                case "palmar":
                case "back":
                case "radial":
                case "ulnar": 
                    side = side.toUpperCase(); 
                    break;
                default: side = "PALMAR"; break;
            }

            switch( location ){
                case "nail": location = "PAD"; break;
                case "pad": location = "PAD"; break;
                case "midjoint": location = "MID"; break;
                case "side": location ="MID"; side = "ULNAR"; break;
                case "base": location = "BASE"; break;
                // case "tip":
                default: location = "TIP"; side = null; break;
            }
        }
        else {
            // default values
            
            switch( side ){
                case "right_at": 
                case "right_beside": 
                    side = "RIGHT"; // realizer will automatically compute wheter it is the ulna or the radius
                    break; 
                case "left_at": 
                case "left_beside": 
                    side = "LEFT"; // realizer will automatically compute wheter it is the ulna or the radius
                    break;
                case "front": side = "PALMAR"; break; 
                case "dorsal": side = "BACK"; break;
                case "palmar":
                case "back":
                case "radial":
                case "ulnar": 
                    side = side.toUpperCase(); 
                    break;
                default: 
                    side = "PALMAR"; 
                    break;
            }

            switch( location ){
                case "wristback": location = "WRIST"; break;
                case "thumbball": location = "THUMB_BALL"; break;
                case "palm": location = "HAND"; side = "PALMAR"; break;
                case "handback": location ="HAND"; side = "BACK"; break;
                case "thumbside": digit = "2"; location = "BASE"; side = "RADIAL"; break;
                case "pinkyside": digit = "5"; location = "BASE"; side = "ULNAR"; break;    

                // arm
                case "upperarm": 
                    location = "UPPER_ARM";
                    side = side == "PALMAR" ? "FRONT" : side;
                    break;
                case "elbow":
                    location = "ELBOW";
                    side = side == "PALMAR" ? "FRONT" : side;
                    break;
                case "elbowinside": 
                    location = "ELBOW";
                    side = "FRONT";
                    break;
                case "lowerarm":
                    location ="FOREARM";
                    side = side == "FRONT" ? "PALMAR" : side;
                    break;

                default: 
                    location = null;
                    side = null;
                break;
            }
        }

        if ( isSecond ){
            if ( digit ){ result.secondFinger = digit; }
            if ( location ){ result.secondLocation = location; }
            if ( side ){ result.secondSide = side; }
        }
        else{
            if ( digit ){ result.finger = digit; }
            if ( location ){ result.location = location; }
            if ( side ){ result.side = side; }
        }
    }

    if ( parseChildren && xml.children.length > 0 && xml.children[0].tagName == "location_hand" ){
        result.child = locationHandInfoExtract( xml.children[0], false );
    }

    result.contact = attributes.contact;


    return result;

    // second_location         %site_hand;
    // second_side             %side;
    // second_digits           CDATA           #IMPLIED
    // approx_second_location  %boolfalse;
}

function locationHandAsHandConstellationParser( xml, start, attackPeak, hand, signGeneralInfo, currentPosture ){
    let locationHand = locationHandInfoExtract( xml, true );
    if ( !locationHand ){ return []; }

    let result = { type: "gesture", start: start, attackPeak: attackPeak, hand: hand, handConstellation: "true" };

    result.hand = hand;
    if ( locationHand.location ){ result.dstLocation = locationHand.location; }
    if ( locationHand.side ){ result.dstSide = locationHand.side; }
    if ( locationHand.finger ){ result.dstFinger = locationHand.finger; }
    if ( locationHand.secondLocation ){ result.secondDstLocation = locationHand.secondLocation; }
    if ( locationHand.secondSide ){ result.secondDstSide = locationHand.secondSide; }
    if ( locationHand.secondFinger ){ result.secondDstFinger = locationHand.secondFinger; }
    if ( locationHand.child ){
        if ( locationHand.child.location ){ result.srcLocation = locationHand.child.location; }
        if ( locationHand.child.side ){ result.srcSide = locationHand.child.side; }
        if ( locationHand.child.finger ){ result.srcFinger = locationHand.child.finger; }
        if ( locationHand.child.secondLocation ){ result.secondSrcLocation = locationHand.child.secondLocation; }
        if ( locationHand.child.secondSide ){ result.secondSrcSide = locationHand.child.secondSide; }
        if ( locationHand.child.secondFinger ){ result.secondSrcFinger = locationHand.child.secondFinger; }
    }else{
        result.srcLocation = "tip";
        result.srcFinger = "1";
    }
    return [ result ];

}

function handConstellationParser( xml, start, attackPeak, hand, signGeneralInfo, currentPosture ){
    let attributes = {};
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    let result = { type: "gesture", start: start, attackPeak: attackPeak, hand: hand, handConstellation: "true" };

    if ( attributes.contact == "touch" ){ result.distance = 0.0; }
    else if ( attributes.contact == "close" ){ result.distance = 0.2; }
    else if ( attributes.contact == "armextended" ){ result.distance = 0.5; }
    else { result.distance = 0.0; } 


    let locBodyArm = null; 
    let locationHandCount = 0;
    for ( let i = 0; ( i < xml.children.length ) && ( i < 3 ); ++i ){

        let child = xml.children[i];
        if ( child.tagName == "location_bodyarm" ){
            locBodyArm = locationBodyArmParser( child, start - 0.0000001, attackPeak, "BOTH", 0x00, signGeneralInfo, currentPosture );
            if ( locBodyArm && locBodyArm.length > 0 ){ locBodyArm = locBodyArm[0]; }
            else{ locBodyArm = null; }
            break;
        }else if ( child.tagName == "location_hand" ){
            let locationHand = locationHandInfoExtract( child, false );
            if ( i == 0 ){
                if ( locationHand.location ){ result.dstLocation = locationHand.location; }
                if ( locationHand.side ){ result.dstSide = locationHand.side; }
                if ( locationHand.finger ){ result.dstFinger = locationHand.finger; }
                if ( locationHand.secondLocation ){ result.secondDstLocation = locationHand.secondLocation; }
                if ( locationHand.secondSide ){ result.secondDstSide = locationHand.secondSide; }
                if ( locationHand.secondFinger ){ result.secondDstFinger = locationHand.secondFinger; }
                locationHandCount++;
            }else{
                if ( locationHand.location ){ result.srcLocation = locationHand.location; }
                if ( locationHand.side ){ result.srcSide = locationHand.side; }
                if ( locationHand.finger ){ result.srcFinger = locationHand.finger; }
                if ( locationHand.secondLocation ){ result.secondSrcLocation = locationHand.secondLocation; }
                if ( locationHand.secondSide ){ result.secondSrcSide = locationHand.secondSide; }
                if ( locationHand.secondFinger ){ result.secondSrcFinger = locationHand.secondFinger; }
                locationHandCount++;
            }
            continue;
        }
        else{
            break;
        }
    }

    // if location hands missing and it is singlehanded, get last handconstellation location and change its distance
    if ( hand != "BOTH" && locationHandCount == 0 ){
        if ( currentPosture.handConstellation ){
            let newResult = JSON.parse( JSON.stringify( currentPosture.handConstellation ) );    
            newResult.distance = result.distance;
            newResult.start = result.start;
            newResult.attackPeak = result.attackPeak;
            if ( locBodyArm ){ return [ locBodyArm, newResult ]; }
            return [ newResult ];
        }
        if ( locBodyArm ){ return locBodyArm; }
        locBodyArm = JSON.parse( JSON.stringify( currentPosture[ hand ][0] ) );    
        locBodyArm.distance = result.distance;
        locBodyArm.start = result.start;
        locBodyArm.attackPeak = result.attackPeak;
        return [ locBodyArm ];
    }

    // must reuse old handconstellation src and dst if no location hands are present
    if ( locationHandCount < 1 ){
        if ( currentPosture && currentPosture.handConstellation ){
            if ( currentPosture.handConstellation.dstLocation ){ result.dstLocation = currentPosture.handConstellation.dstLocation; }
            if ( currentPosture.handConstellation.dstSide ){ result.dstSide = currentPosture.handConstellation.dstSide; }
            if ( currentPosture.handConstellation.dstFinger ){ result.dstFinger = currentPosture.handConstellation.dstFinger; }
        }else{
            // "wachten" sign needs these
            result.dstLocation = "TIP"; 
            result.dstFinger = "1";
        }
    }
    if ( locationHandCount < 2 ){
        if( currentPosture && currentPosture.handConstellation ){
            if ( currentPosture.handConstellation.srcLocation ){ result.srcLocation = currentPosture.handConstellation.srcLocation; }
            if ( currentPosture.handConstellation.srcSide ){ result.srcSide = currentPosture.handConstellation.srcSide; }
            if ( currentPosture.handConstellation.srcFinger ){ result.srcFinger = currentPosture.handConstellation.srcFinger; }
        }else{
            // "wachten" sign needs these
            result.srcLocation = "TIP";
            result.srcFinger = "1";
        }
    }

    if ( locBodyArm ){ return [ locBodyArm, result ]; }
    return [ result ];

}

// function motionParser( xml, start, bothHands, domHand, symmetry, currentPosture, signSpeed ){
function motionParser( xml, start, hand, symmetry, signSpeed, signGeneralInfo, currentPosture ){ // bothHands attribute because a split 
    let result = [];
    let time = start;
    let tagName = xml.tagName;

    // TODO HALT: should change interpolation method
    let attributes = {};
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }
    if ( attributes.fast == "true" ){ signSpeed *= 1.5; }
    if ( attributes.slow == "true" ){ signSpeed *= 0.5; }
    if ( attributes.tense == "true" ){ signSpeed *= 0.5; }
    
    let attrSignSpeed = parseFloat( attributes.speed ); 
    signSpeed *= ( isNaN( attrSignSpeed ) ) ? 1 : attrSignSpeed;
    

    if ( simpleMotionAvailable.includes( tagName ) ){
        let r = simpleMotionParser( xml, time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
        result = result.concat( r.data );
        time = r.end;
    }
    else if ( tagName == "split_motion" ){ // split instruction removes any symmetry. Both_hands flag does not matter
        //<!ELEMENT split_motion ( ( %motion; ), ( %motion; ) ) >

        let maxEnd = time;
        // JaSigning breaks if one motion is missing, but not supporting it now.
        if ( xml.children.length > 0 && motionsAvailable.includes( xml.children[0].tagName ) ){
            let r = motionParser( xml.children[0], time, signGeneralInfo.domHand, 0x00, signSpeed, signGeneralInfo, currentPosture );
            result = result.concat( r.data );
            if( maxEnd < r.end ){ maxEnd = r.end; }
        }
        if ( xml.children.length > 1 && motionsAvailable.includes( xml.children[1].tagName ) ){
            let r = motionParser( xml.children[1], time, signGeneralInfo.nonDomHand, 0x00, signSpeed, signGeneralInfo, currentPosture );
            result = result.concat( r.data );
            if( maxEnd < r.end ){ maxEnd = r.end; }
        }
        time = maxEnd;
    }
    else if ( tagName == "seq_motion" ){
        // <!ELEMENT seq_motion ( ( %motion; ), ( %motion; )+ ) >

        for( let i = 0; i < xml.children.length; ++i ){
            if ( motionsAvailable.includes( xml.children[i].tagName ) ){
                if ( xml.children[i].tagName == "rpt_motion" || xml.children[i].tagName == "tgt_motion" ){
                    currentPosture = currentPostureUpdate( currentPosture, result );    
                }
                let r = motionParser( xml.children[i], time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
                result = result.concat( r.data );
                time = r.end;
            }
        }
    }
    else if ( tagName == "par_motion" ){
        // <!ELEMENT par_motion ( ( %motion; ), ( %motion; )+ ) >

        let maxEnd = time;
        let blockResult = []; // block == motion with children 
        for ( let i = 0; i < xml.children.length; ++i ){
            if ( motionsAvailable.includes( xml.children[i].tagName ) ){
                let r = motionParser( xml.children[i], time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
                blockResult.push( r );
                if ( maxEnd < r.end ){ maxEnd = r.end; }
            }
        }

        // remap bml instructions to the slowest block (motion might have nesting)
        for ( let i = 0; i < blockResult.length; ++i ){
            let block = blockResult[i];
            remapBlockTiming( time, block.end, time, maxEnd, block.data );
            result = result.concat( block.data );
        }
        time = maxEnd;
    }
    else if ( tagName == "tgt_motion" ){
        // <!ELEMENT tgt_motion ( ( %motion; ), ( %posture; ) ) >

        let motionBlock = null;
        let postureBlocks = [];
        let maxEnd = time;
        let locationOrHandconstellation= false;
        for ( let i = 0; i < xml.children.length; ++i ){
            if ( motionsAvailable.includes( xml.children[i].tagName ) ){
                if ( motionBlock || postureBlocks.length ) { break; } // if a second motion is present, all subsequent postures are ignored
                else {
                    motionBlock = motionParser( xml.children[i], time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
                    if ( maxEnd < motionBlock.end ){ maxEnd = motionBlock.end; } 
                } 
            }
            else if ( posturesAvailable.includes( xml.children[i].tagName ) ){
                let r = postureParser( xml.children[i], time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
                postureBlocks.push( r );
                currentPosture = currentPostureUpdate( currentPosture, r.data ); // needed for location_hand in locatoin_bodyarm...
                for ( let l = 0; l < r.data.length; ++l ){
                    if ( r.data[l].locationBodyArm || r.data[l].handConstellation ){ locationOrHandconstellation = true; }
                }
                if ( maxEnd < r.end ){ maxEnd = r.end; } 
            }
        }

        // remap bml instructions to the slowest block (motion might have nesting)
        let motionInstructions = [];
        if ( motionBlock ){
            remapBlockTiming( time, motionBlock.end, time, maxEnd, motionBlock.data );
            motionInstructions = motionBlock.data;
        }
        
        let postureInstructions = [];        
        for ( let i = 0; i < postureBlocks.length; ++i ){
            let block = postureBlocks[i];
            remapBlockTiming( time, block.end, time, maxEnd, block.data );
            postureInstructions = postureInstructions.concat( block.data );
        }

        // TODO: this is not quite correct. All last par directed should be deleted. Also timings might be messed up
        if ( locationOrHandconstellation ){
            let lastDirectedMotionIdx = -1;
            let lastDirectedMotionStart = -1;
            for ( let l = 0; l < motionInstructions.length; ++l ){
                if ( motionInstructions[l].motion == "DIRECTED" && lastDirectedMotionStart < motionInstructions[l].start ){ 
                    lastDirectedMotionStart = motionInstructions[l].start; 
                    lastDirectedMotionIdx = l;
                }
            }            
            if ( lastDirectedMotionIdx > -1 ){ motionInstructions[lastDirectedMotionIdx].distance = 0; } // do not remove as curve and zigzag still work..
        }
        result = result.concat( motionInstructions );
        result = result.concat( postureInstructions );
        time = maxEnd;

    }
    else if ( tagName == "rpt_motion" ){ // TO DO
        // <!ELEMENT rpt_motion ( %motion; ) >

        if ( xml.children.length > 0 && motionsAvailable.includes( xml.children[0].tagName ) ){
            let r = motionParser( xml.children[0], time, hand, symmetry, signSpeed, signGeneralInfo, currentPosture );
            let blockDuration = r.end - time;
            let startTime = time;
            let isBackwardNecessary = false;

            // if all instructions of rpt_motion are motions: check if wrist is displaced with respect to the starting pose. If so, force backward
            for ( let i = 0; i < r.data.length; ++i ){
                if ( !r.data[i].motion ){ isBackwardNecessary = true; break; } // something different than a motion found. Force backward
            }
            if ( !isBackwardNecessary ){
                let motionFinalOffsetDominant = [0,0,0]; // fake Vector3
                let motionFinalOffsetNonDominant = [0,0,0];
                for ( let i = 0; i < r.data.length; ++i ){
                    if ( !r.data[i].motion ){ isBackwardNecessary = true; break; } // something different than a motion found. Force backward
                    let instr = r.data[i];
                    if ( instr.motion == "CIRCULAR" ){ // if not a complete circle, assume backward is necessary
                        let rest = ( instr.startAngle - instr.endAngle ) % 360;
                        if( rest > 0.5 && rest < 359.5 ){  isBackwardNecessary = true; break; }
                    }
                    if ( instr.motion == "DIRECTED" ){
                        if ( instr.hand != signGeneralInfo.nonDomHand ){ // dominant or both
                            let sum = stringToDirection( instr.direction, null, 0x00 );
                            motionFinalOffsetDominant[0] += sum[0] * instr.distance;
                            motionFinalOffsetDominant[1] += sum[1] * instr.distance;
                            motionFinalOffsetDominant[2] += sum[2] * instr.distance;
                        }
                        if ( instr.hand != signGeneralInfo.domHand ){ // non dominat or both
                            let tempSym = !!instr.lrSym | ((!!instr.udSym) < 1 ) | ((!!instr.oiSym) < 2);
                            let sum = stringToDirection( instr.direction, null, tempSym );
                            motionFinalOffsetNonDominant[0] += sum[0] * instr.distance;
                            motionFinalOffsetNonDominant[1] += sum[1] * instr.distance;
                            motionFinalOffsetNonDominant[2] += sum[2] * instr.distance;
                        }
                    }
                }
                let sqDist = motionFinalOffsetDominant[0]*motionFinalOffsetDominant[0] + motionFinalOffsetDominant[1]*motionFinalOffsetDominant[1] + motionFinalOffsetDominant[2]*motionFinalOffsetDominant[2];
                sqDist += motionFinalOffsetNonDominant[0]*motionFinalOffsetNonDominant[0] + motionFinalOffsetNonDominant[1]*motionFinalOffsetNonDominant[1] + motionFinalOffsetNonDominant[2]*motionFinalOffsetNonDominant[2];
                if ( sqDist > 0.0000001 ){ isBackwardNecessary = true; }
            }


            // now instructions can be added
            switch ( attributes.repetition ){
                case "fromstart":  /* forward. Then go directly to the original pose. Forward. Repeat completed */ 
                case "fromstart_several":
                case "manyrandom": /* forward. Then go directly to the original pose. Forward. Repeat completed*/
                    let amountLoops = ( attributes.repetition == "fromstart" ) ? 1 : 2;
                    let loopDuration = blockDuration + isBackwardNecessary * TIMESLOT.POSTURE / signSpeed;
                    for( let loop = 0; loop < amountLoops; ++loop ){
                        
                        // forward
                        let forward = JSON.parse( JSON.stringify( r.data ) ); 
                        for( let i = 0; i < forward.length; ++i ){
                            let fwdInstr = forward[i];
                            if( typeof( fwdInstr.start ) == "number" ){ fwdInstr.start += loop * loopDuration; } 
                            if( typeof( fwdInstr.attackPeak ) == "number" ){ fwdInstr.attackPeak += loop * loopDuration; } 
                            if( typeof( fwdInstr.ready ) == "number" ){ fwdInstr.ready += loop * loopDuration; } 

                            // TODO: combinte extfidir-palmor instructions into one single instruction (with 2 attributes). Remove this if
                            if ( fwdInstr.locationBodyArm || fwdInstr.handshape || fwdInstr.extfidir || fwdInstr.palmor ){ continue; }

                            // let needsNewRelax = fwdInstr.handConstellation || fwdInstr.locationBodyArm || fwdInstr.handshape || fwdInstr.extfidir || fwdInstr.palmor || fwdInstr.motion == "DIRECTED" || fwdInstr.motion == "CIRCULAR";
                            // let needsNewEnd = fwdInstr.handConstellation || fwdInstr.locationBodyArm || fwdInstr.handshape || fwdInstr.extfidir || fwdInstr.palmor || fwdInstr.motion == "DIRECTED" || fwdInstr.motion == "CIRCULAR";
                            
                            let ignoreNewRelax = ( fwdInstr.motion == "FINGERPLAY" || fwdInstr.motion == "WRIST" );
                            if( !isBackwardNecessary && ignoreNewRelax && i == (forward.length -1) ){ // if no backwardtions are of the same type (fingerplay or wrist),  
                                fwdInstr.relax = startTime + ( loop + 1 ) * loopDuration; // force fingerplay/wrist until end of loop
                                fwdInstr.end = startTime + ( loop + 1 ) * loopDuration + TIMESLOT.POSTURE / signSpeed; // to avoid floating problems. It will be overwritten by the following fingerplay/wrist
                            } // force fingerplay/wrist until end of loop
                            else{
                                // unspecified "relax" and "end" should be all synchronized to the end of their loop iteration
                                if( typeof( fwdInstr.relax ) == "number" ){ fwdInstr.relax += loop * loopDuration; } 
                                else if( !ignoreNewRelax ) { fwdInstr.relax = startTime + loop * loopDuration + blockDuration; } // fingerplay and wrist compute relax at the end of sign_manual parser
                                if( typeof( fwdInstr.end ) == "number" ){ fwdInstr.end += loop * loopDuration; }
                                else{ fwdInstr.end = startTime + ( loop + 1 ) * loopDuration; }
                            }
                        }
                        result = result.concat( forward );

                        time += blockDuration; // add forward time

                        // backward
                        if ( isBackwardNecessary ){
                            let backward = [];
                            let backwardAddConstellation = false;
                            // check which actions are performend in rpt and select their backward position
                            for( let i = 0; i < r.data.length; ++i ){
                                let type = -1;
                                let d = r.data[i];
                                if ( d.locationBodyArm ){ type = 0; }
                                else if ( d.extfidir ){ type = 1; }
                                else if ( d.palmor ){ type = 2; }
                                else if ( d.handshape ){ type = 3; }
                                else if ( d.handConstellation ){ type = 4; }

                                if ( type == 4 ){ backwardAddConstellation = !!currentPosture.handConstellation; } // flag as true only if there was a previous handconstellation
                                else if ( type > -1 ){
                                    if ( d.hand == "RIGHT" || d.hand == "BOTH" ){ backward.push( JSON.parse( JSON.stringify( currentPosture["RIGHT"][ type ] ) ) ); }
                                    if ( d.hand == "LEFT" || d.hand == "BOTH" ){ backward.push( JSON.parse( JSON.stringify( currentPosture["LEFT"][ type ] ) ) ); }

                                    // there was a handconstellation before rpt_motion
                                    if ( d.locationBodyArm && currentPosture.handConstellation ){ backwardAddConstellation |= currentPosture.handConstellation.hand == "BOTH" || d.locationBodyArm.hand == currentPosture.handConstellation.hand; }
                                }                            
                            }
                            // fix timings of backward instructions
                            for ( let i = 0; i < backward.length; ++i ){
                                backward[i].start = time - 0.00001;
                                backward[i].attackPeak = time + TIMESLOT.POSTURE / signSpeed;            
                            }
                            result = result.concat( backward );
                            if ( backwardAddConstellation ){
                                backward = JSON.parse( JSON.stringify( currentPosture.handConstellation ) )
                                backward.start = time; 
                                backward.attackpeak = time + TIMESLOT.POSTURE / signSpeed;
                                result.push( backward );
                            }
                            time += TIMESLOT.POSTURE / signSpeed; // add backward time
                        }
                    }

                    // final forward
                    let finalForward = r.data;
                    let offset = amountLoops * loopDuration;
                    for( let i = 0; i < finalForward.length; ++i ){
                        if( !isNaN( finalForward[i].start ) ){ finalForward[i].start += offset; } 
                        if( !isNaN( finalForward[i].attackPeak ) ){ finalForward[i].attackPeak += offset; } 
                        if( !isNaN( finalForward[i].ready ) ){ finalForward[i].ready += offset; } 
                        if( !isNaN( finalForward[i].relax ) ){ finalForward[i].relax += offset; } 
                        if( !isNaN( finalForward[i].end ) ){ finalForward[i].end += offset; } 
                    }
                    result = result.concat( finalForward );
                    
                    time += blockDuration; // add forward time

                    break;
                case "tofroto": /* forward. inverse of everything. forward again */ 
                    // timings during reverse are inverted

                    // circular:  swap endAngle and startAngle
                    // directed:  use  with all symmetry set to the direction (curve should not be necessary)
                    // wrist and fingerplay: nothing special

                    // posture: be careful with start and attackpeak timings
                break;
                case "reverse": /* tofroto without last forward. So only forward, backward */ break;
                case "continue": /* forward. keeps directed. After each repetition, quickly go to original posture. Forward. */ 
                case "continue_several":
                    // same as fromstart but keeps directedmotion offset. Remember we remove directed and circular after each location_bodyarm on our realizer
                break;
                case "swap": /* no repetition, may be deprecated. Use default */
                default:
                    result = result.concat( r.data );
                    time += blockDuration; // add forward time
                    break;
            }

        }
    }

    if ( attributes.rest == "true" ){ time += TIMESLOT.REST / signSpeed; }

    return{ data: result, end: time }
}

// necessary for nesting such in tgt and par
function remapBlockTiming ( srcStart, srcEnd, dstStart, dstEnd, bmlArray ){
    let timings = [ "start", "attackPeak", "relax", "end", "ready" ];
    
    for( let i = 0; i < bmlArray.length; ++i ){
        let bml = bmlArray[i];

        for( let j = 0; j < timings.length; ++j ){
            if ( typeof( bml[ timings[j] ] ) == "number" ){
                let f = ( bml[ timings[j] ] - srcStart ) / ( srcEnd - srcStart ); 
                bml[ timings[j] ] = dstStart * ( 1.0 - f ) + dstEnd * f ;        
            }
        }    
    }
}

function simpleMotionParser( xml, start, hand, symmetry, signSpeed, signGeneralInfo, currentPosture ){
    let resultArray = [];
    let duration = 0;
    let attributes = {}
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        attributes[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    if ( xml.tagName == "directedmotion" ){
        let result = {};
        result.motion = "DIRECTED";

        result.direction = attributes.direction;
        if ( attributes.size == "big" ){ result.distance = 0.2; }
        else if( attributes.size == "small" ){ result.distance = 0.06; }
        else{ result.distance = 0.12; }

        if ( attributes.second_direction ){
            result.seconDirection = attributes.second_direction;
            if ( attributes.second_size == "big" ){ result.distance = 0.5 * result.distance + 0.5 * 0.15; }
            else if ( attributes.second_size == "small" ){  result.distance = 0.5 * result.distance + 0.5 * 0.06; }
        }
    
        if ( attributes.curve ){
            result.curve = attributes.curve;
            if ( attributes.curve_size == "big" ){ result.curveSize = 0.5; }
            else if ( attributes.curve_size == "small" ){ result.curveSize = 0.05; }
            else { result.curveSize = 0.15; }
        }

        if ( attributes.zigzag_style == "wavy" || attributes.zigzag_style == "zigzag" ){ 
            result.zigzag = "l"; result.zigzagSpeed = 5 * signSpeed; 
            if ( attributes.zigzag_size == "big" ){ result.zigzagSize = 0.3; } // "small" == default value
            else { result.zigzagSize = 0.1; } // "small" == default value
        }
        
        duration = TIMESLOT.MOTIONDIR / signSpeed;
        result.attackPeak = start + duration;
        resultArray.push( result );
    }
    else if ( xml.tagName == "circularmotion" ){
        let result = {};
        result.motion = "CIRCULAR";
        
        result.direction = attributes.axis;
        if ( attributes.size == "big" ){ result.distance = 0.1; }
        else if ( attributes.size == "small" ){ result.distance = 0.02; }
        else { result.distance = 0.05; }
        
        if ( attributes.second_axis ){
            result.seconDirection = attributes.second_axis;
        }

        let startDirection = stringToDirection( attributes.start, null, symmetry );
        let endDirection = stringToDirection( attributes.end, null, symmetry );

        if ( startDirection[0]*startDirection[0] + startDirection[1]*startDirection[1] + startDirection[2]*startDirection[2] < 0.0000001 ) { result.startAngle = 0; }
        else{ 
            result.startAngle = Math.atan2( startDirection[1], startDirection[0] ) * 180 / Math.PI;
            result.startAngle = result.startAngle < 0 ? ( 360 + result.startAngle ) : result.startAngle;     
        }
        if ( endDirection[0]*endDirection[0] + endDirection[1]*endDirection[1] + endDirection[2]*endDirection[2] < 0.0000001 ) { result.endAngle = result.startAngle + 360; }
        else{ 
            result.endAngle = Math.atan2( endDirection[1], endDirection[0] ) * 180 / Math.PI; 
            result.endAngle = result.endAngle < 0 ? ( 360 + result.endAngle ) : result.endAngle;
        }

        let clockplus = 0;
        if ( attributes.clockplus == "true" ){ clockplus++; }
        if ( attributes.second_clockplus == "true" ){ clockplus++; }
        if ( clockplus ){ 
            let sign = ( result.endAngle - result.startAngle ) < -0.0001 ? -1 : 1;
            result.endAngle = result.endAngle + 360 * clockplus * sign;
        } 
        if ( typeof( result.direction ) == "string" && result.direction.includes( "i" ) ){
                result.endAngle = (result.endAngle - result.startAngle) + ( result.startAngle * (-1) ); // new_start + old_deltaAngle
                result.startAngle *= -1; // new_start
        }

        if ( attributes.zigzag_style == "wavy" || attributes.zigzag_style == "zigzag" ){ 
            result.zigzag = "o"; 
            result.zigzagSpeed = 8 * signSpeed; 
            if ( attributes.zigzag_size == "big" ){ result.zigzagSize = 0.1; }
            else { result.zigzagSize = 0.05; }
        }

        let ellipseRatio = 0.5;
        switch( attributes.ellipse_size ){
            case "big" : ellipseRatio = 0.25; break;
            case "small" : ellipseRatio = 0.75; break;
            default: ellipseRatio = 0.5; break;
        }
        switch( attributes.ellipse_direction ){
            case "h": result.ellipseAxisDirection = "l"; result.ellipseAxisRatio = ellipseRatio; break;
            case "ur": result.ellipseAxisDirection = "ur"; result.ellipseAxisRatio = ellipseRatio; break;
            case "v": result.ellipseAxisDirection = "u"; result.ellipseAxisRatio = ellipseRatio; break;
            case "ul": result.ellipseAxisDirection = "ul"; result.ellipseAxisRatio = ellipseRatio; break;
            default: break; // defaults to ellipseAxisRatio = 0.5
        }

        duration = (1+clockplus) * TIMESLOT.MOTIONCIRC / signSpeed;
        result.start = start;
        result.attackPeak = start + duration;
        resultArray.push( result );

        // wait for a 180º of phase between hands (even if angles are shorter than 180)
        if ( hand == "BOTH" && signGeneralInfo.outofphase ){ 
            let resultOutOfPhase = JSON.parse( JSON.stringify( result ) );
            let timeTo180 = 90 * duration / Math.abs( result.endAngle - result.startAngle ); // how much timet would need to move 180º
            resultOutOfPhase.start += timeTo180;
            resultOutOfPhase.attackPeak += timeTo180;
            resultOutOfPhase.hand = signGeneralInfo.nonDomHand;
            resultArray.push( resultOutOfPhase );
            result.hand = signGeneralInfo.domHand;
            duration += timeTo180;
        }
    }
    else if ( xml.tagName == "wristmotion" && attributes.motion ){
        let result = {};
        result.motion = "WRIST";
        if ( attributes.size == "big" ){ result.intensity = 0.3; } 
        else { result.intensity = 0.1; }
        result.mode = attributes.motion.toUpperCase().replace("STIR", "STIR_");
        result.speed = 4 * signSpeed;

        // non dominant hand always shows symmetry except on nodding
        if ( result.mode != "nodding" && result.mode != "nod" ){ result.lrSym = true; }

        duration = TIMESLOT.MOTIONWRIST / signSpeed;
        result.end = start + duration;
        resultArray.push( result );
    }
    else if ( xml.tagName == "fingerplay" ){
        let result = {};
        result.motion = "FINGERPLAY";
        result.intensity = 0.5;
        result.speed = 4 * signSpeed;
        duration = TIMESLOT.MOTIONFINGERPLAY / signSpeed;
        result.end = start + duration;
        if ( attributes.digits ){ result.fingers = attributes.digits; }
        else{
            let h = hand == "BOTH" ? signGeneralInfo.domHand : hand;
            h = currentPosture[ h ][3].handshape;
            if( h.includes( "CEE" ) || h.includes( "PINCH" ) ){ result.fingers = "12345"; }
            else{ result.fingers = "2345"; } // if too bent, fingers don't move
        }

        resultArray.push( result );
    } 

    for( let i = 0; i < resultArray.length; ++i ){
        let o = resultArray[i];
        o.type = "gesture";
        if ( !o.start ) { o.start = start; }
        if ( !o.hand ) { o.hand = hand; } 

        if ( symmetry & 0x01 ){ o.lrSym = true; }
        // o.udSym = 0x00; // symmetry & 0x02; Jasiggning: does not work 
        if ( symmetry & 0x04 ){ o.oiSym = true; }
    }

    return { data: resultArray, end: start + duration };

}



// ###############################################
// #              Non Manual Parser              #
// ###############################################

function signNonManual( xml, start, signSpeed ){
    // [ is tier done, par tag, available tags ]
    let tiersAvailable = { // only one instance of each is allowed in jasigning
        shoulder_tier:   [ false, "shoulder_par",   [ "shoulder_movement" ] ],
        body_tier:       [ false, "body_par",       [ "body_movement" ] ],
        head_tier:       [ false, "head_par",       [ "head_movement" ] ],
        eyegaze_tier:    [ false, "eye_par",        [ "eye_gaze" ] ],
        facialexpr_tier: [ false, "facial_expr_par",[ "eye_gaze", "eye_brows", "eye_lids", "nose" ] ], //for some reason eye_gaze works also
        mouthing_tier:   [ false, "mouthing_par",   [ "mouth_gesture", "mouth_picture", "mouth_meta" ] ],
        extra_tier:      [ false, "extra_par",      [ "extra_movement" ] ],
    };
    // todo: "neutral" is an available tag, but not used in our database

    let result = [];
    let end = start;
    start += TIMESLOT.HAND / signSpeed; // start after basic hand-arm positioning

    /**
     * Result = [ whatever tier, whatever tier, ... ]
     * Whatever tier = [ instructions, instructions, ... ]
     * Instructions = [ single bml, single bml ]
     * 
     * Different tiers do NOT get into each other with timings. Each reproduces their "instructions" sequentally. 
     * While an "instructions" reaches peak, the previous reaches end. Except the last "instructions", which will be kept at peak until MFs finish.
     * Some "instructions" are composed of several mini bmls, that is reason for it being an array
     * All timing 
    */
    
    for ( let i = 0; i < xml.children.length; ++i ){ // check all present tiers
        let tier = tiersAvailable[ xml.children[i].tagName ];
        if ( tier && !tier[0] ){ // if tier is not already done
            tier[0] = true; // flag tier as done
            let actions = xml.children[i].children;
            let time = start; // start after basic hand-arm positioning
            let tierLasActions = [-1,-1];
            for( let a = 0; a < actions.length; ++a ){ // check all actions inside this tier
                if ( tier[2].includes( actions[a].tagName ) ){ // simple sequential action ( jasigning )
                    let r = baseNMFActionToJSON( actions[a], time, signSpeed );
                    if ( !r || r.length < 1 ){ continue; }
                    tierLasActions[0] = result.length;
                    tierLasActions[1] = r.data.length;
                    result = result.concat( r.data );
                    time = r.end;
                }
                else if ( tier[1] == actions[a].tagName ){ // set of parallel actions
                    // all actions inside par tag start and end at the same time, regardless of action type
                    let subActions = actions[a].children;
                    let subMaxEnd = time;
                    for ( let sa = 0; sa < subActions.length; ++sa ){ // check all actions inside parallel tag
                        if ( tier[2].includes( subActions[sa].tagName ) ){
                            // sequential actions ( jasigning )
                            let r = baseNMFActionToJSON( subActions[sa], time, signSpeed );
                            if ( !r || r.length < 1 ){ continue; }
                            result = result.concat( r.data );
                            if ( r.end > subMaxEnd ){ subMaxEnd = r.end; }
                        }
                    }
                    time = subMaxEnd;
                }
            } // end of for actions in tier
            if ( end < time ){ end = time; }
        }        
    } // end of of for tier

    return { data: result, end: end };
}

function baseNMFActionToJSON( xml, startTime, signSpeed ){
    // parse attributes from array of xml objects into an object where key=tagName, value=xml.value
    let obj = {}
    for( let attr = 0; attr < xml.attributes.length; ++attr ){
        obj[ xml.attributes[attr].name ] = xml.attributes[attr].value;
    }

    // Incoming signSpeed is ignored. Only speeds inside the basic instruction are taken into account. 
    signSpeed = parseFloat( obj.speed );
    signSpeed = isNaN( signSpeed ) ? 1 : signSpeed;
    let signAmount = parseFloat( obj.amount );
    signAmount = isNaN( signAmount ) ? 1 : signAmount; 

    let result = null;
    switch( xml.tagName ){
        case "shoulder_movement": result = shoulderMovementTable[ obj.movement ]; break;  // - movement   
        case "body_movement": result = bodyMovementTable[ obj.movement ]; break; // - movement
        case "head_movement": result = headMovementTable[ obj.movement ]; break; // - movement
        case "eye_gaze": result = eyeGazeTable[ obj.movement || obj.direction ]; break;  // direction or movement. movement has priority even if wrong
        case "eye_brows": result = eyebrowsTable[ obj.movement ]; break;
        case "eye_lids": result = eyelidsTable[ obj.movement ]; break;
        case "nose": result = noseTable[ obj.movement ]; break;
        case "mouth_gesture": result = mouthGestureTable[ obj.movement ]; break; // - movement
        case "mouth_picture": 
            let text = obj.picture;
            // transform text from SIL encoding to ARPABET encoding
            result = { type:"speech", text:text+".", sentInt: 0.5 };
            break; // - picture
        case "mouth_meta": break; // - mouthmetatype    --- ?????
        case "extra_movement": break; // - movement     --- ?????
        case "neutral": break; // - -
        default:
            return null;
    }

    if ( !result ){ return null; }
    result = JSON.parse( JSON.stringify( result ) );

    // post process
    if ( !Array.isArray( result ) ){
        result = [ result ];
    }
    let maxEnd = startTime;
    for( let i = 0; i < result.length; ++i ){
        let o = result[i];

        // modify amount/intensity depending of sign's amount
        if ( o.hasOwnProperty( "amount" ) ){ o.amount *= signAmount; }
        else if ( o.hasOwnProperty( "shoulderRaise" ) ){ o.shoulderRaise *= signAmount; }
        else if ( o.hasOwnProperty( "shoulderHunch" ) ){ o.shoulderHunch *= signAmount; }

        // adust timing
        o.start = o.start ? ( startTime + o.start / signSpeed ) : startTime;
        if ( o.type == "speech" ) { 
            if( o.speed ) { o.sentT = o.text.length * o.speed; }
            o.sentT = ( o.sentT / signSpeed ) || ( o.text.length / ( 6.66 * signSpeed ) ); // default to 6.66 phonemes per second
            if ( o.start + o.sentT > maxEnd ){ maxEnd = o.start + o.sentT; }
        } 
        else {

            if ( o.duration || o.end ){
                // realizer will infer peak and relax from start and end
                let duration = o.end ? ( (startTime + o.end) - o.start) : o.duration;
                o.end = o.start + duration / signSpeed; 
                if ( o.end > maxEnd ){ maxEnd = o.end; } 
            }else{  
                let repetition = o.repetition ? o.repetition : 0;
                o.attackPeak = o.start + TIMESLOT.NMFSTARTPEAK / signSpeed  ;
                o.relax = o.attackPeak + ( ( 1 + repetition ) * TIMESLOT.NMFWAIT ) / signSpeed;
                o.end = o.relax + ( TIMESLOT.NMFRELAXEND ) / signSpeed;
                
                // set duration of the sign. Default relax
                let timeToTest = o.relax;
                if ( o._durationUntilEnd ){ timeToTest = o.end; delete o._durationUntilEnd; }
                // else if ( o._durationUntilPeak ){ timeToTest = o.attackPeak; delete o._durationUntilPeak; }
                
                if ( timeToTest > maxEnd ){
                    maxEnd = timeToTest;
                }
            }
        }
    }
    return { data: result, end: maxEnd };
}

let shoulderMovementTable = {
    // keeps that position until it changes or the sign ends
    UL: { type: "gesture", shoulderRaise: 0.55, hand: "LEFT"  }, //_left_shoulder_raised                
    UR: { type: "gesture", shoulderRaise: 0.55, hand: "RIGHT" }, //_right_shoulder_raised               
    UB: { type: "gesture", shoulderRaise: 0.55, hand: "BOTH"  }, //_both_shoulders_raised               
    HL: { type: "gesture", shoulderHunch: 0.8, hand: "LEFT"  }, //_left_shoulder_hunched_forward       
    HR: { type: "gesture", shoulderHunch: 0.8, hand: "RIGHT" }, //_right_shoulder_hunched_forward      
    HB: { type: "gesture", shoulderHunch: 0.8, hand: "BOTH"  }, //_both_shoulders_hunched_forward     
    
    // up and down once
    SL: { type: "gesture", shoulderRaise: 0.55, hand: "LEFT", _durationUntilEnd: true }, //_left_shoulder_shrugging_up_and_down 
    SR: { type: "gesture", shoulderRaise: 0.55, hand: "RIGHT", _durationUntilEnd: true }, //_right_shoulder_shrugging_up_and_down
    SB: { type: "gesture", shoulderRaise: 0.55, hand: "BOTH", _durationUntilEnd: true }, //_both_shoulders_shrugging_up_and_down
};

let bodyMovementTable = {
    RL: { type: "gesture", bodyMovement: "ROTATE_LEFT", amount: 0.7 }, // _rotated_left
    RR: { type: "gesture", bodyMovement: "ROTATE_RIGHT", amount: 0.7 }, // _rotated_right
    TL: { type: "gesture", bodyMovement: "TILT_LEFT", amount: 0.5 }, // _tilted_left
    TR: { type: "gesture", bodyMovement: "TILT_RIGHT", amount: 0.5 }, // _tilted_right
    TF: { type: "gesture", bodyMovement: "TILT_FORWARD", amount: 0.5 }, // _tilted_forwards
    TB: { type: "gesture", bodyMovement: "TILT_BACKWARD", amount: 0.5 }, // _tilted_backwards
    RD: { type: "gesture", bodyMovement: "TILT_FORWARD", amount: 0.4 }, // _round  sligthly tilted forwards
    SI: { type: "gesture", bodyMovement: "TILT_BACKWARD", amount: 0.3 }, // _sigh  slightly tilted backwards
    // HE: { type: "gesture", bodyMovement: "HE", amount: 1 }, // _heave   does not work
    // ST: { type: "gesture", bodyMovement: "ST", amount: 1 }, // _straight 
}

let headMovementTable = {
    NO: { type: "head", lexeme: "NOD", repetition: 1 }, //_nodding_up_and_down     
    SH: { type: "head", lexeme: "SHAKE", repetition: 3 }, //_shaking_left_and_right  
    SR: { type: "head", lexeme: "ROTATE_RIGHT", repetition: 0 }, //_turned_right            
    SL: { type: "head", lexeme: "ROTATE_LEFT", repetition: 0 }, //_turned_left             
    TR: { type: "head", lexeme: "TILT_RIGHT", repetition: 0 }, //_tilted_right            
    TL: { type: "head", lexeme: "TILT_LEFT", repetition: 0 }, //_tilted_left             
    NF: { type: "head", lexeme: "TILT_FORWARD", repetition: 0 }, //_tilted_forward          
    NB: { type: "head", lexeme: "TILT_BACKWARD", repetition: 0 }, //_tilted_back             
    PF: { type: "head", lexeme: "FORWARD", repetition: 0 }, //_pushed_forward          
    PB: { type: "head", lexeme: "BACKWARD", repetition: 0 }, //_pushed_backward         
    //LI: , //_head_movement_linked_to_eye_gaze
};
let eyeGazeTable = {
    AD:{ type: "gaze", influence: "EYES", target: "CAMERA" },   // _towards_addressee                           
    FR:{ type: "gaze", influence: "EYES", target: "FRONT" },    // _far                                         
    // HD:{ type: "gaze", influence: "EYES", target: "FRONT" }, // _towards_the_signer_s_own_hands              
    // HI:{ type: "gaze", influence: "EYES", target: "FRONT" }, // _towards_the_signer_s_own_dominant_hand      
    // HC:{ type: "gaze", influence: "EYES", target: "FRONT" }, // _towards_the_signer_s_own_non_dominant_hand  
    // RO:{ type: "gaze", influence: "EYES", target: "FRONT" }, // _rolling_eyes                                
    NO:{ type: "gaze", influence: "EYES", target: "FRONT" },    // _no_target_unfocussed                        
    UP:{ type: "gaze", influence: "EYES", target: "UP" },       // _up                                          
    DN:{ type: "gaze", influence: "EYES", target: "DOWN" },     // _down                                        
    LE:{ type: "gaze", influence: "EYES", target: "LEFT" },     // _left                                        
    RI:{ type: "gaze", influence: "EYES", target: "RIGHT" },    // _right                                       
    LU:{ type: "gaze", influence: "EYES", target: "UP_LEFT" },   // _left_up                                     
    LD:{ type: "gaze", influence: "EYES", target: "DOWN_LEFT" }, // _left_down                                   
    RU:{ type: "gaze", influence: "EYES", target: "UP_RIGHT" },  // _right_up                                    
    RD:{ type: "gaze", influence: "EYES", target: "DOWN_RIGHT" },// _right_down
};
let eyebrowsTable = {
    RB: { type: "faceLexeme", lexeme: "BROW_RAISER", amount: 1 }, 
    RR: { type: "faceLexeme", lexeme: "BROW_RAISER_RIGHT", amount: 1 },
    RL: { type: "faceLexeme", lexeme: "BROW_RAISER_LEFT", amount: 1 },
    FU: { type: "faceLexeme", lexeme: "BROW_LOWERER", amount: 1 },
};
let eyelidsTable = {
    WB: { type: "faceLexeme", lexeme: "UPPER_LID_RAISER", amount: 1 },      // wide open
    WR: { type: "faceLexeme", lexeme: "UPPER_LID_RAISER_RIGHT", amount: 1 },// wide open
    WL: { type: "faceLexeme", lexeme: "UPPER_LID_RAISER_LEFT", amount: 1 }, // wide open
    SB: { type: "faceLexeme", lexeme: "EYES_CLOSED", amount: 0.4 },         // slightly closed
    SR: { type: "faceLexeme", lexeme: "WINK_RIGHT", amount: 0.4 },          // slightly closed
    SL: { type: "faceLexeme", lexeme: "WINK_LEFT", amount: 0.4 },           // slightly closed
    CB: { type: "faceLexeme", lexeme: "EYES_CLOSED", amount: 1 },           // closed
    CR: { type: "faceLexeme", lexeme: "WINK_RIGHT", amount: 1 },            // closed
    CL: { type: "faceLexeme", lexeme: "WINK_LEFT", amount: 1 },             // closed
    TB: { type: "faceLexeme", lexeme: "EYES_CLOSED", amount: 1 },           // closed
    TR: { type: "faceLexeme", lexeme: "WINK_RIGHT", amount: 1 },            // closed
    TL: { type: "faceLexeme", lexeme: "WINK_LEFT", amount: 1 },             // closed
    // BB: blink at the end of the sign 
};
let noseTable = {
    WB: { type: "faceLexeme", lexeme: "NOSE_WRINKLER", amount: 1 }, // wrinkle
//     TW: twitch
//     WI: widening nostrils
};
let mouthGestureTable = {
    D01:    { type: "speech",     text: "IIIIs ",                  sentInt: 0.4, sentT: 0.8 }, //_eee_sss                                                     
    D02:    { type: "speech",     text: "ffff ",                   sentInt: 0.4, sentT: 0.6 }, //_f         // in jasiging D02 and D03 are mixed                                                 
    D03:    { type: "speech",     text: "Efff ",                   sentInt: 0.4, sentT: 0.6 }, //_ef                                                         
    D04:    { type: "speech",     text: "afff ",                   sentInt: 0.4, sentT: 0.6 }, //_af                                                         
    D05: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0,   duration: 0.15 },                                            
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.15,duration: 0.15 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.3, duration: 0.15 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.45,duration: 0.15 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.6, duration: 0.15 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.75,duration: 0.15 },
         ], //_clattering_teeth
    D06: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.02, start: 0,   duration: 0.3 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0,   duration: 0.3 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0,   duration: 0.3 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0,   duration: 0.3 },                    
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.02, start: 0.2, duration: 0.2 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0.2, duration: 0.2 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0.2, duration: 0.2 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.2, duration: 0.2 },                    
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.02, start: 0.3, duration: 0.2 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0.3, duration: 0.2 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0.3, duration: 0.2 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.3, duration: 0.2 },                    
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.02, start: 0.45,duration: 0.2 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0.45,duration: 0.2 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0.45,duration: 0.2 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.45,duration: 0.2 },                    
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.02, start: 0.6, duration: 0.2 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0.6, duration: 0.2 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0.6, duration: 0.2 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.6, duration: 0.2 },                    
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.02, start: 0.75,duration: 0.2 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount:  0.4, start: 0.75,duration: 0.2 },                                            
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.1, start: 0.75,duration: 0.2 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.75,duration: 0.2 },                    
        ],  //_clattering_teeth_with_raised_upper_lip 
    D07: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.4, start: 0,    duration: 0.3 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount: 0.2, start: 0,    duration: 0.3 },
            { type: "faceLexeme", lexeme: "LOWER_LIP_DEPRESSOR",   amount: 0.4, start: 0,    duration: 0.3 },
            { type: "speech",     text: "mm ",                     start: 0.25, sentInt: 0.5,sentT: 0.5 }
         ], //_one_bite_resulting_in_closed_teeth                         
    D08: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.4, start: 0,    duration: 0.3 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount: 0.6, start: 0.1,  duration: 0.8 },
            { type: "faceLexeme", lexeme: "LOWER_LIP_DEPRESSOR",   amount: 0.8, start: 0,    duration: 0.8 },
            { type: "faceLexeme", lexeme: "JAW_DROP",              amount: -0.3, start: 0.25,duration: 0.5 },
         ], //_one_bite_lips_stretched_teeth_visible                      
    D09: [  { type: "speech",     text: "tAiii ",                    sentInt: 0.8, sentT: 0.5 }, 
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",            amount: 1, start: 0.3,    duration: 0.5 }
         ],//_teeth_on_lower_lip_open_almost_close_tongue_behind_upper_teeth    --> CAN'T BE DONE (NOT TONGUE BLENDSHAPES)

    J01: [  { type: "faceLexeme", lexeme: "JAW_SIDEWAYS_LEFT",     amount: 0.5, start: 0,   duration: 0.2 }, //{ type: "faceLexeme", lexeme: "LIP_PUCKERER_LEFT",  amount: -0.3, start: 0,   duration: 0.2} , { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT", amount: 0.3, start: 0,   duration: 0.2 },
            { type: "faceLexeme", lexeme: "JAW_SIDEWAYS_RIGHT",    amount: 0.5, start: 0.2, duration: 0.2 }, //{ type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT", amount: -0.3, start: 0.2, duration: 0.2} , { type: "faceLexeme", lexeme: "LIP_PUCKERER_LEFT",  amount: 0.3, start: 0.2, duration: 0.2 },
            { type: "faceLexeme", lexeme: "JAW_SIDEWAYS_LEFT",     amount: 0.5, start: 0.4, duration: 0.2 }, //{ type: "faceLexeme", lexeme: "LIP_PUCKERER_LEFT",  amount: -0.3, start: 0.4, duration: 0.2} , { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT", amount: 0.3, start: 0.4, duration: 0.2 },
            { type: "faceLexeme", lexeme: "JAW_SIDEWAYS_RIGHT",    amount: 0.5, start: 0.6, duration: 0.2 }, //{ type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT", amount: -0.3, start: 0.6, duration: 0.2} , { type: "faceLexeme", lexeme: "LIP_PUCKERER_LEFT",  amount: 0.3, start: 0.6, duration: 0.2 }
         ], //_lower_jaw_moves_sideways_left_and_right                    
    J02: [  { type: "faceLexeme", lexeme: "JAW_DROP",              amount: 0.7, start: 0,   duration: 0.6 }, { type: "faceLexeme", lexeme: "JAW_THRUST",  amount: -0.3, start: 0,   duration: 0.6 }, { type: "faceLexeme", lexeme: "MOUTH_STRETCH",  amount: -0.35, start: 0,   duration: 0.6 },
            { type: "faceLexeme", lexeme: "JAW_DROP",              amount: 0.7, start: 0.8, duration: 0.6 }, { type: "faceLexeme", lexeme: "JAW_THRUST",  amount: -0.3, start: 0.8, duration: 0.6 }, { type: "faceLexeme", lexeme: "MOUTH_STRETCH",  amount: -0.35, start: 0.8, duration: 0.6 },
            { type: "faceLexeme", lexeme: "JAW_DROP",              amount: 0.7, start: 1.6, duration: 0.6 }, { type: "faceLexeme", lexeme: "JAW_THRUST",  amount: -0.3, start: 1.6, duration: 0.6 }, { type: "faceLexeme", lexeme: "MOUTH_STRETCH",  amount: -0.35, start: 1.6, duration: 0.6 },
            { type: "faceLexeme", lexeme: "JAW_DROP",              amount: 0.7, start: 2.4, duration: 0.6 }, { type: "faceLexeme", lexeme: "JAW_THRUST",  amount: -0.3, start: 2.4, duration: 0.6 }, { type: "faceLexeme", lexeme: "MOUTH_STRETCH",  amount: -0.35, start: 2.4, duration: 0.6 },
         ], //_lower_jaw_chews_mouth_remains_closed                       
    J03: [  { type: "faceLexeme", lexeme: "JAW_THRUST",            amount: 1, start: 0, duration: 0.8 }, { type: "faceLexeme", lexeme: "JAW_DROP",  amount: 0.16, start: 0, duration: 0.8 }, { type: "faceLexeme", lexeme: "LOWER_LIP_DEPRESSOR",  amount: 0.9, start: 0,   duration: 0.8 }
         ], //_mouth_open_jaw_forward_teeth_visible                       
    J04:    { type: "speech",     text: "GA GA GA GA GA",          sentInt: 0.5, sentT: 1 }, //_mouth_open_jaw_gagaga_at_pharynx                           
          
    L02:    { type: "speech",     text: "p r r r",                 phInt: [0.2, 0.3, 0.3, 0.3], phT: [0.2, 0.05, 0.05, 0.05] }, //_prrr                                                       
    L01:    { type: "speech",     text: " S ",                     sentInt: 1.2, sentT: 0.7}, //_sh                                                         
    L03:    { type: "speech",     text: "p r",                     phInt: [0.15, 0.3], phT: [0.2, 0.2] }, //_pr                                                         
    L04:    { type: "faceLexeme", lexeme: "LIP_TIGHTENER",         amount: 0.8, start: 0,   duration: 0.8 }, //_pursed_lips                                                
    L05:    { type: "speech",     text: " Oo ",                    sentInt: 1.2, sentT: 0.8 }, //_o_oa_open_o                                                
    L06:    { type: "speech",     text: " O ",                     sentInt: 0.8, sentT: 0.8 }, //_ooo_closed_o                                               
    L07:    { type: "speech",     text: " o ",                     sentInt: 1.2, sentT: 0.7 }, //_oa                                                         
    L08:    { type: "speech",     text: "boAm ",                   phInt: [0.1, 0.3, 0.2, 0.3], phT: [0.1, 0.05, 0.05, 0.05] }, //_boam                                                       
    L09:    { type: "speech",     text: "bAm ",                    phInt: [0.1, 0.5, 0.2],  phT: [0.1, 0.1, 0.05] }, //_bam                                                        
    L10:    { type: "speech",     text: "boA A ",                  phInt: [0.5, 0.5, 1, 1], phT: [0.1, 0.05, 0.3, 0.1] }, //_boa                                                        
    L11:    { type: "speech",     text: "b A ",                    sentInt: 0.5, phT: [0.1, 0.2] }, //_ba                                                         
    L12:    { type: "speech",     text: "bii ",                    phInt: [0.1, 1, 1], phT: [0.1, 0.15, 0.5] }, //_bee                                                        
    L13:    { type: "speech",     text: "pYY ",                    phInt: [0.1, 0.6, 0.6], phT: [0.05, 0.2, 0.3] }, //_pi                                                         
    L14:    { type: "speech",     text: "pCh",                     phInt: [0.1, 1, 0.8], phT: [0.1, 0.2, 0.4] }, //_pch                                                        
    L15: [  { type: "speech",     text: "bs",                      sentInt: 0.3, sentT: 0.3 },
            { type: "faceLexeme", lexeme: "LIPS_PART",             amount: 1,  start: 0.2,     duration: 0.9 }, 
         ],//_bsss_bee                                                   
    L16:    { type: "speech",     text: "pff ",                    sentInt: 0.5, phT: [0.05, 0.2, 0.3, 0.1]}, //_pf                                                         
    L17:    { type: "speech",     text: "ppA ",                    phInt: [0.1,0.01, 0.01, 0.01], phT: [0.1, 0.1, 0.03, 0.05]}, //_p                                                          
    L18:    { type: "speech",     text: "pApApA ",                 sentInt: 0.05, sentT: 0.6 }, //_p_p_p                                                      
    L19: [  { type: "faceLexeme", lexeme: "ROUND_OPEN",        amount: 0.3, start: 0, duration: 0.6 },
            { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.9, start: 0, duration: 0.6 }
         ], //_phh                                                        
    L20: [  { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.2, start: 0, duration: 0.9 },
            { type: "faceLexeme", lexeme: "LIP_CORNER_PULLER",     amount: 0.2, start: 0, duration: 0.9 },
            { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 0.9, start: 0, duration: 0.9 },
            
         ], //_phh                                                   
    // L21: { type: "speech", text: "", sentInt: 0.3 }, //_ph  --> NOT WORKING ON JASigning                                                       
    L22: [  { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.2, start: 0, duration: 0.4 },
            { type: "faceLexeme", lexeme: "LIP_CORNER_PULLER",     amount: 0.2, start: 0, duration: 0.4 },
            { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 0.9, start: 0, duration: 0.4 }

         ], //_ph                                                         
    L23:    { type: "speech",     text: "mmm ",                    sentInt: 0.2 }, //_mmm                                                        
    L24:    { type: "speech",     text: "ma m ",                   phInt: [0.1, 0.05, 0.05, 0.2], phT: [0.1, 0.1, 0.05, 0.45, 0.2] }, //_mmm_while_holding_breath                                   
    L25:    { type: "speech",     text: "mamama ",                 phInt: [0.2, 0.05, 0.2, 0.05, 0.2, 0.05], sentT: 0.7 }, //_m_m_m                                                      
    L26:    { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER_RIGHT",amount: 0.8,  start: 0,   duration: 0.8 }, //_one_side_of_upper_lip_raised                               
    L27: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.25, start: 0,   duration: 0.6 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 1,    start: 0,   duration: 0.6 }
         ], //_mouth_slightly_open_tongue_to_upper_close_lips_hidden      ----> CAN'T BE DONE (NOT BLENDSHAPES FOR TONGUE)
    L28: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.5,  start: 0,   duration: 0.6 }, 
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 1,    start: 0,   duration: 0.6 }
         ], //_tongue_on_upper_lip_close_mouth_lips_hidden          ----> CAN'T BE DONE (NOT BLENDSHAPES FOR TONGUE)
    L29: [  { type: "faceLexeme", lexeme: "LIP_CORNER_DEPRESSOR",  amount: 0.15, start: 0,   duration: 0.6 }, 
            { type: "faceLexeme", lexeme: "DIMPLER",               amount: 0.6,  start: 0,   duration: 0.6 },
            { type: "faceLexeme", lexeme: "LID_TIGHTENER",         amount: 0.25, start: 0,   duration: 0.6 }
         ], //_lips_closed_hidden_mouth_corners_curved_down               
    L30: [  { type: "faceLexeme", lexeme: "LIP_CORNER_DEPRESSOR",  amount: 0.6,  start: 0,   duration: 0.7 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.4,  start: 0,   duration: 0.7 },
            { type: "faceLexeme", lexeme: "LID_TIGHTENER",         amount: 0.25, start: 0,   duration: 0.7 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: -0.1, start: 0,   duration: 0.7 }
         ], //_lips_pursed_curved_down                                    
    L31: [  { type: "faceLexeme", lexeme: "LIP_CORNER_DEPRESSOR",  amount: 0.15, start: 0,   duration: 0.6 }, 
            { type: "faceLexeme", lexeme: "DIMPLER",               amount: 0.6,  start: 0,   duration: 0.6 },
            { type: "faceLexeme", lexeme: "LID_TIGHTENER",         amount: 0.25, start: 0,   duration: 0.6 }
         ], //_lips_closed_corners_of_mouth_curved_down        (???? --> same as L29)            
    L32: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.1,  start: 0,     duration: 0.8 }, 
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.3, start: 0.1,   duration: 0.1 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: 0.2,  start: 0.2,   duration: 0.1 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.3, start: 0.3,   duration: 0.1 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: 0.2,  start: 0.4,   duration: 0.1 },
         ], //_mouth_slightly_open_blow_lips_vibrate_initially            
    L33:    { type: "speech",     text: "A S ",                    phInt: [0.3, 0.8, 0.8, 0.8], phT: [0.1, 0.05, 0.55, 0.05] }, //_mouth_open_close_sh_with_teeth_showing                     
    L34:    { type: "faceLexeme", lexeme: "LIP_CORNER_PULLER",     amount: 0.5,  start: 0,     duration: 0.6 }, //_lips_closed_stretched_strongly                             
    L35: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: -0.4, start: 0,     duration: 1.45 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.4,  start: 0,     duration: 1.45 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.2,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.2, start: 0.2,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.2,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.05, start: 0.6,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: -0.2, start: 0.6,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "LIP_SUCK_UPPER",        amount: -0.2, start: 0.6,   duration: 0.4 },
            
         ], //_blow_out_air_through_slightly_open_lips                    
    
    C01:    { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 1,    start: 0,   duration: 0.8 }, //_puffed_cheeks                                              
    C02: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 0.8,  start: 0,   duration: 0.8 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.2,  start: 0,   duration: 0.8 } 
         ], //_cheeks_and_lip_area_puffed                                 
    C03:    { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 0.8,  start: 0,   duration: 0.8 }, //_gradually_puffing_cheeks  (???? --> same as C01)                                 
    C04: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 1,    start: 0,   duration: 0.8 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT",    amount: -0.2, start: 0,   duration: 0.8 } 
         ], //_one_cheek_puffed                                           
    C05: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 0.8,  start: 0,   duration: 0.4 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT",    amount: -0.2, start: 0,   duration: 0.4 } 
         ], //_one_cheek_puffed_while_briefly_blowing_out_air             
    C06: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 0.8,  start: 0,   duration: 0.4 }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT",    amount: -0.2, start: 0,   duration: 0.4 } 
         ], //_one_cheek_puffed_briefly_blowing_air_cheek_pushed          (???? --> same as C05)
    C07:    { type: "faceLexeme", lexeme: "CHEEK_SUCK",            amount: 1,    start: 0,   duration: 0.8 }, //_cheeks_sucked_in                                           
    C08: [  { type: "faceLexeme", lexeme: "CHEEK_SUCK",            amount: 1,    start: 0,   duration: 0.8 }, 
            { type: "faceLexeme", lexeme: "LIP_FUNNELER",          amount: 1,    start: 0,   duration: 0.8 }
         ], //_cheeks_sucked_in_sucking_in_air                            
    // C09: { type: "speech", text: "", sentInt: 0.3 }, //_tongue_pushed_visibly_into_cheek             ----> CAN'T BE DONE (NOT BLENDSHAPES FOR TONGUE)              
    // C10: { type: "speech", text: "", sentInt: 0.3 }, //_tongue_repeatedly_pushes_into_cheek          ----> CAN'T BE DONE (NOT BLENDSHAPES FOR TONGUE)
    C11: [  { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 1,    start: 0,   duration: 0.2  }, 
            { type: "faceLexeme", lexeme: "LIP_PUCKERER_RIGHT",    amount: -0.2, start: 0,   duration: 0.85 },
            { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 1,    start: 0.2, duration: 0.2  }, 
            { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 1,    start: 0.4, duration: 0.2  }, 
            { type: "faceLexeme", lexeme: "CHEEK_BLOW_RIGHT",      amount: 1,    start: 0.6, duration: 0.25 }, 
         ], //_one_cheek_puffed_blow_out_briefly_at_corner_several_times  
    C12: [  { type: "faceLexeme", lexeme: "LIP_SUCK_LOWER",        amount: 0.8,  start: 0,   duration: 0.8  }, 
            { type: "faceLexeme", lexeme: "JAW_THRUST",            amount: 1,    start: 0,   duration: 0.8 }
         ], //_lips_closed_tongue_pushed_behind_lower_lip                 
    C13: [  { type: "faceLexeme", lexeme: "JAW_DROP",              amount: 0.3,  start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "UPPER_LIP_RAISER",      amount: -0.6, start: 0,   duration: 0.8 }
        ],//_cheeks_slightly_in_jaw_down_blow_closed_lips_several_times 
    
    T01:    { type: "speech",     text: "lllll ",                  sentInt: 1,   sentT: 0.5 }, //_l                                                          
    T02: [  { type: "speech",     text: "lllll ",                  sentInt: 1,   sentT: 0.5 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.3,  start: 0 }
         ], //_tip_of_tongue_slightly_protruding                          
    // T03: { type: "speech", text: "", sentInt: 0.3 }, //_l_l_l       ---> CAN'T BE DONE (NOT TONGUE BLENDSHAPES)                                               
    T04: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.45,  start: 0,   duration: 0.4 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0,   duration: 0.4 }
         ], //_tongue_sticks_out_briefly                                  
    T05: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.5,   start: 0,   duration: 1 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.55,  start: 0,   duration: 1 }
         ], //_a                                                          
    T06: [  { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.45,  start: 0,   duration: 0.35 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0,   duration: 0.35 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.45,  start: 0.25,duration: 0.35 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0.25,duration: 0.35 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.45,  start: 0.55,duration: 0.35 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0.55,duration: 0.35 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",         amount: 0.45,  start: 0.85,duration: 0.35 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0.85,duration: 0.35 }
         ], //_tongue_sticking_out_repeatedly                             
    T07:    { type: "speech",     text: "la la la la ",            phInt: [1, 1, 0.1, 1, 1, 0.1,1, 1, 0.1,1, 1, 0.1,],  sentT: 1.2 }, //_lalala                                                     
    T08:    { type: "speech",     text: "al al al al ",            phInt: [1, 1, 0.1, 1, 1, 0.1,1, 1, 0.1,1, 1, 0.1,],  sentT: 1.2 }, //_alalal                                                     
    T09:    { type: "speech",     text: "als ",                    sentInt: 0.8,  sentT: 0.6 }, //_als            --> NOT IMPLEMENTED ON JASigning                                            
    T10:    { type: "speech",     text: "llff ",                   sentInt: 0.8,  sentT: 0.6 }, //_lf                                                         
    T11:    { type: "speech",     text: "loaf ",                   sentInt: 0.5,  sentT: 0.6 }, //_laf                                                        
    // T12: { type: "speech", text: "", sentInt: 0.3 }, //_tip_of_tongue_touches_one_corner_of_the_mouth          --> CAN'T BE DONE (NOT TONGUE BLENDSHAPES)   
    T13: [  { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 0.5,   start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "CHEEK_BLOW",            amount: 0.4,   start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.2,   start: 0,   duration: 0.8 },
         ], //_tongue_tip_between_lower_lip_lower_teeth_middle_tongue_showing 
    // T14: { type: "speech", text: "", sentInt: 0.3 }, //_tip_of_tongue_is_protruded_and_moving_sidewards        --> CAN'T BE DONE (NOT TONGUE BLENDSHAPES)    
    // T15: { type: "speech", text: "", sentInt: 0.3 }, //_oval_circling_movement_of_tongue_in_open_mouth         --> CAN'T BE DONE (NOT TONGUE BLENDSHAPES)    
    T16: [  { type: "faceLexeme", lexeme: "LIP_PUCKERER",          amount: 0.8,   start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "TONGUE_SHOW",           amount: 1,     start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "CHIN_RAISER",           amount: -0.4,  start: 0,   duration: 0.8 },
            { type: "faceLexeme", lexeme: "MOUTH_STRETCH",            amount: 0.2,   start: 0,   duration: 0.8 },
         ], //_lips_pursed_with_tip_of_tongue_protruding                  
    // T17: { type: "speech", text: "", sentInt: 0.3 }, //_mouth_open_tongue_protrudes_briefly
}




// Correct negative blenshapes shader of ThreeJS
THREE.ShaderChunk[ 'morphnormal_vertex' ] = "#ifdef USE_MORPHNORMALS\n	objectNormal *= morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n	    objectNormal += getMorph( gl_VertexID, i, 1, 2 ) * morphTargetInfluences[ i ];\n		}\n	#else\n		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];\n		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];\n		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];\n		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];\n	#endif\n#endif";
THREE.ShaderChunk[ 'morphtarget_pars_vertex' ] = "#ifdef USE_MORPHTARGETS\n	uniform float morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];\n		uniform sampler2DArray morphTargetsTexture;\n		uniform vec2 morphTargetsTextureSize;\n		vec3 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset, const in int stride ) {\n			float texelIndex = float( vertexIndex * stride + offset );\n			float y = floor( texelIndex / morphTargetsTextureSize.x );\n			float x = texelIndex - y * morphTargetsTextureSize.x;\n			vec3 morphUV = vec3( ( x + 0.5 ) / morphTargetsTextureSize.x, y / morphTargetsTextureSize.y, morphTargetIndex );\n			return texture( morphTargetsTexture, morphUV ).xyz;\n		}\n	#else\n		#ifndef USE_MORPHNORMALS\n			uniform float morphTargetInfluences[ 8 ];\n		#else\n			uniform float morphTargetInfluences[ 4 ];\n		#endif\n	#endif\n#endif";
THREE.ShaderChunk[ 'morphtarget_vertex' ] = "#ifdef USE_MORPHTARGETS\n	transformed *= morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n			#ifndef USE_MORPHNORMALS\n				transformed += getMorph( gl_VertexID, i, 0, 1 ) * morphTargetInfluences[ i ];\n			#else\n				transformed += getMorph( gl_VertexID, i, 0, 2 ) * morphTargetInfluences[ i ];\n			#endif\n		}\n	#else\n		transformed += morphTarget0 * morphTargetInfluences[ 0 ];\n		transformed += morphTarget1 * morphTargetInfluences[ 1 ];\n		transformed += morphTarget2 * morphTargetInfluences[ 2 ];\n		transformed += morphTarget3 * morphTargetInfluences[ 3 ];\n		#ifndef USE_MORPHNORMALS\n			transformed += morphTarget4 * morphTargetInfluences[ 4 ];\n			transformed += morphTarget5 * morphTargetInfluences[ 5 ];\n			transformed += morphTarget6 * morphTargetInfluences[ 6 ];\n			transformed += morphTarget7 * morphTargetInfluences[ 7 ];\n		#endif\n	#endif\n#endif";

class ScriptApp {

    constructor() {
        
        this.elapsedTime = 0; // clock is ok but might need more time control to dinamicaly change signing speed
        this.clock = new THREE.Clock();
        this.loaderGLB = new GLTFLoader();
        
        this.controllers = {}; // store avatar controllers
        this.ECAcontroller = null; // current selected
        this.eyesTarget = null;
        this.headTarget = null;
        this.neckTarget = null;
        
        this.msg = {};
        
        this.languageDictionaries = {}; // key = NGT, value = { glosses: {}, word2ARPA: {} }
        this.selectedLanguage = "NGT";       

        this.loadedIdleAnimations = {};
        this.bindedIdleAnimations = {};
        this.currentIdle = "";
        this.baseSkeleton = null;
        this.applyIdle = false;

        this.intensity = 0.3;
        this.speed = 1;

        this.mood = "Neutral";
        this.moodIntensity = 1.0;
        
        this.scene = null;
    }

    // loads dictionary for mouthing purposes. Not synchronous.
    loadMouthingDictionary( language ){
        let that = this;
               
        fetch("./data/dictionaries/" + language + "/IPA/ipa.txt").then(x => x.text()).then(function(text){ 

            let texts = text.split("\n");
            let IPADict = {}; // keys: plain text word,   value: ipa transcription
            let ARPADict = {}; // keys: plain text word,   value: arpabet transcription
            
            //https://www.researchgate.net/figure/1-Phonetic-Alphabet-for-IPA-and-ARPAbet-symbols_tbl1_2865098                
            let ipaToArpa =  {
                // symbols
                "'": "", // primary stress
                '.': " ", // syllable break
                
                // vowels
                'a': "a",   'ɑ': "a",   'ɒ': "a", 
                'œ': "@",   'ɛ': "E",   'ɔ': "c",
                'e': "e",   'ø': "e",   'ə': "x",   'o': "o",  
                'ɪ': "I",   'i': "i",   'y': "i",   'u': "u",   'ʉ': "u",

                // consonants
                'x': "k",   'j': "y",   't': "t",   'p': "p",   'l': "l",   'ŋ': "G", 
                'k': "k",   'b': "b",   's': "s",   'ʒ': "Z",   'm': "m",   'n': "n", 
                'v': "v",   'r': "r",   'ɣ': "g",   'f': "f",   'ʋ': "v",   'z': "z", 
                'h': "h",   'd': "d",   'ɡ': "g",   'ʃ': "S",   'ʤ': "J"
            };
            let errorPhonemes = {};


            for(let i = 0; i < texts.length; ++i){
                let a = texts[i].replace("\t", "").split("\/");
                if (a.length < 2 || a[0].length == 0 || a[1].length == 0 ){ continue; }

                IPADict[ a[0] ] = a[1];

                let ipa = a[1];
                let arpa = "";

                // convert each IPA character into correpsonding ARPABet
                for( let j = 0; j < ipa.length; ++j ){
                    if ( ipa[j] == 'ː' || ipa[j] == ":" ) { arpa += arpa[arpa.length-1]; continue; }
                    let s = ipaToArpa[ ipa[j] ];
                    if ( s != undefined ){ arpa += s; continue; }
                    errorPhonemes[ s ];
                }

                ARPADict[ a[0] ] = arpa; 

            }

            if ( Object.keys(errorPhonemes).length > 0 ){ console.error( "MOUTHING: loading phonetics: unmapped IPA phonemes to ARPABET: \n", errorPhonemes ); }

            that.languageDictionaries[ language ].word2ARPA = ARPADict;

        });
    }

    // convert plain text into phoneme encoding ARPABet-1-letter. Uses dictionaries previously loaded 
    wordsToArpa ( phrase, language = "NGT" ){
        
        if ( !this.languageDictionaries[ language ] || !this.languageDictionaries[ language ].word2ARPA ){
            console.warn( "missing word-ARPABET dictionary for " + language );
            return "";
        }
        let word2ARPA = this.languageDictionaries[ language ].word2ARPA;
        let words = phrase.replace(",", "").replace(".", "").split(" ");

        let result = "";
        let unmappedWords = [];
        for ( let i = 0; i < words.length; ++i ){
            let r = word2ARPA[ words[i] ] ;
            if ( r ){ result += " " + r; }
            else{ unmappedWords.push( words[i]); }
        }
        if ( unmappedWords.length > 0 ){ console.error("MOUTHING: phrase: ", phrase, "\nUnknown words: ",JSON.stringify(unmappedWords)); }
        return result;
    
    }

    loadLanguageDictionaries( language ){
        this.languageDictionaries[ language ] = { glosses: null, wordsToArpa: null };

        this.loadMouthingDictionary( language );

        fetch( "./data/dictionaries/" + language + "/Glosses/_glossesDictionary.txt").then( (x)=>x.text() ).then( (file) =>{
            let glossesDictionary = this.languageDictionaries[ language ].glosses = {};
            let lines = file.split("\n");
            for( let i = 0; i < lines.length; ++i ){
                if ( !lines[i] || lines[i].length < 1 ){ continue; }
                let map = lines[i].split("\t");
                if ( map.length < 2 ){ continue; }
                glossesDictionary[ map[0] ] = map[1].replace("\r", "").replace("\n", "");
            }
        } );
    }

    async loadIdleAnimations(animations)
    {
        let loader = new BVHLoader();
        let promises = [];

        // Load current character
        for(let i = 0; i < animations.length; i++) {
            let filePromise = fetch(animations[i]).then(x => x.text()).then((text) =>{ 
                const data = loader.parseExtended(text);
                const name = animations[i].split("/").pop();
                
                this.loadBVHAnimation( name, data );
            })
            promises.push(filePromise);
        }

        return Promise.all(promises);
    }

    // load animation from bvhe file
    loadBVHAnimation(name, animationData) { // TO DO: Refactor params of loadAnimation...()

        let skeleton = null;
        let bodyAnimation = null;
        let faceAnimation = null;
        if ( animationData && animationData.skeletonAnim ){
            skeleton = animationData.skeletonAnim.skeleton;
            if(!skeleton) {
                return;
            }
            skeleton.bones.forEach( b => { b.name = b.name.replace( /[`~!@#$%^&*()|+\-=?;:'"<>\{\}\\\/]/gi, "") } );
            // loader does not correctly compute the skeleton boneInverses and matrixWorld 
            skeleton.bones[0].updateWorldMatrix( false, true ); // assume 0 is root
            skeleton = new THREE.Skeleton( skeleton.bones ); // will automatically compute boneInverses
            
            animationData.skeletonAnim.clip.tracks.forEach( b => { b.name = b.name.replace( /[`~!@#$%^&*()|+\-=?;:'"<>\{\}\\\/]/gi, "") } );     
            animationData.skeletonAnim.clip.name = "bodyAnimation";
            bodyAnimation = animationData.skeletonAnim.clip;
        }
        
        if ( animationData && animationData.blendshapesAnim ){
            animationData.blendshapesAnim.clip.name = "faceAnimation";       
            faceAnimation = animationData.blendshapesAnim.clip;
        }
        
        this.loadedIdleAnimations[name] = {
            name: name,
            bodyAnimation: bodyAnimation ?? new THREE.AnimationClip( "bodyAnimation", -1, [] ),
            faceAnimation: faceAnimation ?? new THREE.AnimationClip( "faceAnimation", -1, [] ),
            skeleton,
            type: "bvhe"
        };
    }

    /**
     * KeyframeEditor: fetches a loaded animation and applies it to the character. The first time an animation is binded, it is processed and saved. Afterwards, this functino just changes between existing animations 
     * @param {String} animationName 
     * @param {String} characterName 
     */
    bindAnimationToCharacter(animationName, characterName) {
        
        let animation = this.loadedIdleAnimations[animationName];
        if(!animation) {
            console.warn(animationName + " not found");
            return false;
        }
        this.currentAnimation = animationName;
        
        let currentCharacter = this.controllers[characterName];
        if(!currentCharacter) {
            console.warn(characterName + ' not loaded')
        }
      
        currentCharacter.originalSkeleton.pose(); // for some reason, mixer.stopAllAction makes bone.position and bone.quaternions undefined. Ensure they have some values
        // if not yet binded, create it. Otherwise just change to the existing animation
        if ( !this.bindedIdleAnimations[animationName] || !this.bindedIdleAnimations[animationName][currentCharacter.character.name] ) {
            let bonesNames = [];
            let bodyAnimation = animation.bodyAnimation;        
            if(bodyAnimation) {
            
                let tracks = [];        
                // Remove position changes (only keep i == 0, hips)
                for (let i = 0; i < bodyAnimation.tracks.length; i++) {

                    if(bodyAnimation.tracks[i].name.includes('position')) {
                        continue;
                    }
                    tracks.push(bodyAnimation.tracks[i]);
                    tracks[tracks.length - 1].name = tracks[tracks.length - 1].name.replace( /[\[\]`~!@#$%^&*()|+\-=?;:'"<>\{\}\\\/]/gi, "").replace(".bones", "");
                }

                bodyAnimation.tracks = tracks;            
                let skeleton = animation.skeleton;
            
                let retargeting = new AnimationRetargeting(skeleton, currentCharacter.character, { trgUseCurrentPose: true, trgEmbedWorldTransforms: true, srcPoseMode: AnimationRetargeting.BindPoseModes.TPOSE, trgPoseMode: AnimationRetargeting.BindPoseModes.TPOSE } ); // TO DO: change trgUseCurrentPose param
                bodyAnimation = retargeting.retargetAnimation(bodyAnimation);
                
                bonesNames = this.validateAnimationClip(bodyAnimation);
                bodyAnimation.name = "bodyAnimation";   // mixer
            }
                
            let faceAnimation = animation.faceAnimation;        
           
            if(!this.bindedIdleAnimations[animationName]) {
                this.bindedIdleAnimations[animationName] = {};
            }
            this.bindedIdleAnimations[animationName][currentCharacter.character.name] = {
                mixerBodyAnimation: bodyAnimation, mixerFaceAnimation: faceAnimation, bonesNames // for threejs mixer 
            }
        }

        let bindedAnim = this.bindedIdleAnimations[animationName][currentCharacter.character.name];
        
        // Remove current animation clip
        let mixer = currentCharacter.mixer;
        mixer.stopAllAction();
        
        while(mixer._actions.length){
            mixer.uncacheClip(mixer._actions[0]._clip); // removes action
        }

        mixer.clipAction(bindedAnim.mixerBodyAnimation).setEffectiveWeight(this.intensity).play();
        mixer.update(0);

        this.mixer = mixer;
        this.duration = bindedAnim.mixerBodyAnimation.duration;
       
        // Clone skeleton with first frame of animation applied, for using it in additive blending
        let bones = currentCharacter.originalSkeleton.bones;
        let resultBones = new Array( bones.length );
        
        // bones[0].clone( true ); // recursive
        for( let i = 0; i < bones.length; ++i ){
            resultBones[i] = bones[i].clone(false);
            resultBones[i].parent = null;
        }
        
        for( let i = 0; i < bones.length; ++i ){
            let parentIdx = findIndexOfBone(currentCharacter.originalSkeleton, bones[i].parent);
            if ( parentIdx > -1 ){ resultBones[ parentIdx ].add( resultBones[ i ] ); }   
        }
        
        resultBones[0].updateWorldMatrix( false, true ); // assume 0 is root. Update all global matrices (root does not have any parent)          
        this.baseSkeleton = new THREE.Skeleton(resultBones);       

        return true;
    }

    /** Validate body animation clip created using ML */
    validateAnimationClip(clip) {

        let newTracks = [];
        let tracks = clip.tracks;
        let bones = this.ECAcontroller.originalSkeleton.bones;
        let bonesNames = [];
        tracks.map((v) => { bonesNames.push(v.name.split(".")[0])});

        for(let i = 0; i < bones.length; i++)
        {
            
            let name = bones[i].name;
            if(bonesNames.indexOf( name ) > -1)
                continue;
            let times = [0];
            let values = [bones[i].quaternion.x, bones[i].quaternion.y, bones[i].quaternion.z, bones[i].quaternion.w];
            
            let track = new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, values);
            newTracks.push(track);
            
        }
        clip.tracks = clip.tracks.concat(newTracks);
        return bonesNames;
    }

    init(scene) {
        this.loadLanguageDictionaries( "NGT" );
        
        // Behaviour Planner
        this.eyesTarget = new THREE.Object3D(); //THREE.Mesh( new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshPhongMaterial({ color: 0xffff00 , depthWrite: false }) );
        this.eyesTarget.name = "eyesTarget";
        this.eyesTarget.position.set(0, 2.5, 15); 
        this.headTarget = new THREE.Object3D(); //THREE.Mesh( new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshPhongMaterial({ color: 0xff0000 , depthWrite: false }) );
        this.headTarget.name = "headTarget";
        this.headTarget.position.set(0, 2.5, 15); 
        this.neckTarget = new THREE.Object3D(); //THREE.Mesh( new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshPhongMaterial({ color: 0x00fff0 , depthWrite: false }) );
        this.neckTarget.name = "neckTarget";
        this.neckTarget.position.set(0, 2.5, 15); 

        scene.add(this.eyesTarget);
        scene.add(this.headTarget);
        scene.add(this.neckTarget);

        this.scene = scene;
    }
        
    update( deltaTime ) {
        deltaTime*=this.speed;
        this.elapsedTime += deltaTime;
        
        if ( this.ECAcontroller ){ this.ECAcontroller.update( deltaTime, this.elapsedTime ); }
        
        const bmlSkeleton = this.ECAcontroller.skeleton;
        const animatedSkeleton = this.ECAcontroller.originalSkeleton;
        // Apply additive blending animation to the bml animation
        if(this.applyIdle && this.baseSkeleton && this.mixer) {
            if(!this.bindedIdleAnimations[this.currentIdle]) {
                this.bindAnimationToCharacter(this.currentIdle, this.ECAcontroller.character.name);
            }

            if(this.mixer) {
                this.mixer.update(deltaTime/this.speed);           
            }

            const anim = this.bindedIdleAnimations[this.currentIdle][this.ECAcontroller.character.name];
            const boneNames = anim.bonesNames;
            
            for(let i = 0; i < bmlSkeleton.bones.length; i++) {
                
                let input = bmlSkeleton.bones[i].quaternion.clone();
                
                if(bmlSkeleton.bones[i].name.includes("RightHand") || bmlSkeleton.bones[i].name.includes("LeftHand") || boneNames.indexOf(bmlSkeleton.bones[i].name) < 0) {
                    animatedSkeleton.bones[i].quaternion.copy(input);
                    animatedSkeleton.bones[i].position.copy(bmlSkeleton.bones[i].position);                    
                    continue;
                }
                const add = animatedSkeleton.bones[i].quaternion.clone();
                const addBase = this.baseSkeleton.bones[i].quaternion.clone();
                input.multiply(addBase.invert().multiply(add));
                animatedSkeleton.bones[i].quaternion.copy(input);
            }
            animatedSkeleton.bones[0].updateWorldMatrix(false, true);
        
        } else {
            for(let i = 0; i < bmlSkeleton.bones.length; i++) { 
                animatedSkeleton.bones[i].position.copy(bmlSkeleton.bones[i].position);
                animatedSkeleton.bones[i].quaternion.copy(bmlSkeleton.bones[i].quaternion);
                animatedSkeleton.bones[i].scale.copy(bmlSkeleton.bones[i].scale);
            }

        }
    }

    replay() {
        if(!this.msg) {
            return;
        }
        
        this.ECAcontroller.processMsg( JSON.parse( JSON.stringify(this.msg) ) ); 
    }

    onLoadAvatar(newAvatar, config, skeleton){
        let position = newAvatar.position;
        let rotation = newAvatar.quaternion;
        let scale = newAvatar.scale;
  
        newAvatar.position.set(0,0,0);
        newAvatar.quaternion.set(0,0,0,1);
        newAvatar.scale.set(1,1,1);

        newAvatar.eyesTarget = this.eyesTarget;
        newAvatar.headTarget = this.headTarget;
        newAvatar.neckTarget = this.neckTarget;
            
        const mixer = new THREE.AnimationMixer(newAvatar);  
        this.mixer = mixer;

        // Clone skeleton in bind pose for the CharacterController (compute the animation in an auxiliary skeleton)
        skeleton.pose();
        let bones = skeleton.bones;
        let resultBones = new Array( bones.length );
        
        // bones[0].clone( true ); // recursive
        for( let i = 0; i < bones.length; ++i ){
            resultBones[i] = bones[i].clone(false);
            resultBones[i].parent = null;
        }
        
        for( let i = 0; i < bones.length; ++i ){
            let parentIdx = findIndexOfBone( skeleton, bones[i].parent )
            if ( parentIdx > -1 ){ resultBones[ parentIdx ].add( resultBones[ i ] ); }   
        }

        let root = bones[0].parent.clone(false);
        root.add(resultBones[0]);
        // if(bones[0].parent.parent) {
        //     let parent = bones[0].parent.parent.clone(false);
        //     parent.add(root);
        //     this.scene.add(parent)
        // }
        // else {
        //     this.scene.add(root)
        // }
        resultBones[0].updateWorldMatrix( true, true ); // assume 0 is root. Update all global matrices (root does not have any parent)
        let resultSkeleton = new THREE.Skeleton(resultBones);

        let ECAcontroller = new CharacterController( {character: newAvatar, characterConfig: config, skeleton: resultSkeleton} );
        ECAcontroller.start();
        ECAcontroller.reset();
        ECAcontroller.processMsg( { control: 2 } ); // speaking mode
        ECAcontroller.originalSkeleton = skeleton;
        ECAcontroller.mixer = mixer;

        this.ECAcontroller = this.controllers[newAvatar.name] = ECAcontroller;

        if(!Object.keys(this.loadedIdleAnimations).length) {
            this.loadIdleAnimations(["./data/animations/Idle.bvh", "./data/animations/SitIdle.bvh", "./data/animations/standingIdle.bvh"]).then((v) => {
                if(!Object.keys(this.loadedIdleAnimations).length) {return;}
                this.currentIdle = Object.keys(this.loadedIdleAnimations)[0].replace("./data/animations/", "");
            })
        }
        else {
            this.bindAnimationToCharacter(this.currentIdle, newAvatar.name);
        }

        newAvatar.position.copy(position);
        newAvatar.quaternion.copy(rotation);
        newAvatar.scale.copy(scale);
    }

    onChangeAvatar(avatarName) {
        if (!this.controllers[avatarName]) { 
            return false; 
        }
        this.ECAcontroller = this.controllers[avatarName];
        return true;
    }

    getLookAtPosition(target = new THREE.Vector3()) {
        if( this.ECAcontroller ) { 
            this.ECAcontroller.skeleton.bones[ this.ECAcontroller.characterConfig.boneMap["ShouldersUnion"] ].getWorldPosition( target ); 
        }
        return target;
    }

    async processMessageFiles( files = []) {
        let promises = [];
        for(let i = 0; i < files.length; i++) {
            let filePromise = null;
            const file = files[i];
            if(file.data) {
                if(file.type == 'bml' || file.type == 'sigml') {
                    filePromise = new Promise(resolve => {
                            resolve(file);
                    });
                }
            }
            else {
                const extension = file.name.substr(file.name.lastIndexOf(".") + 1);;
                if(extension == 'bml' || extension == 'sigml') {
                    filePromise = new Promise(resolve => {
                        fetch(file.name).then(response => response.text()).then((data) => {
                            resolve({type: extension, data});
                        })
                        
                    });
                }
            }
            promises.push(filePromise); 
        }
        return Promise.all(promises);
    }

    /* 
    * Given an array of blocks of type { type: "bml" || "sigml" || "glossName",  data: "" } where data contains the text instructions either in bml or sigml.
    * It computes the sequential union of all blocks.
    * Provides a way to feed the app with custom bmls, sigml 
    * Returns duration of the whole array, without delayTime
    */
    async processMessageRawBlocks( glosses = [], delayTime = 0 ){
        if ( !glosses ){ return null; }

        delayTime = parseFloat( delayTime );
        delayTime = isNaN( delayTime ) ? 0 : delayTime;
        let time = delayTime;
        let orders = []; // resulting bml instructions
        let glossesDictionary = this.languageDictionaries[ this.selectedLanguage ].glosses;
        
        let peakRelaxDuration = 0;
        let relaxEndDuration = 0;
        
        for( let i = 0; i < glosses.length; ++i ){
            let gloss = glosses[i];
            
            try{ 
                // if gloss name. First fetch file, update gloss data and continue
                if ( gloss.type == "glossName" ){
                    let glossFile = glossesDictionary[ gloss.data ];
                    if ( !glossFile ){  // skipping gloss
                        gloss = { type: "invalid" };
                    }
                    else{ 
                        await fetch( "./data/dictionaries/" + this.selectedLanguage + "/Glosses/" + glossFile ).then(x=>x.text()).then( (text) =>{ 
                            let extension = glossFile.split(".");
                            extension = extension[ extension.length - 1 ];
                            gloss = { type: extension, data: text };
                        } );    
                    }
                }

                if ( gloss.type == "bml" ){ // BML
                    let result = gloss.data;
                    if( typeof( result ) == "string" ){ result = JSON.parse( result ) };
                    if ( Array.isArray( result.behaviours ) ){ result = result.behaviours; } // animics returns this
                    else if ( Array.isArray( result.data ) ){ result = result.data; } // bml messages uses this
                    else if ( !Array.isArray( result ) ){ throw "error"; }

                    time = time - relaxEndDuration - peakRelaxDuration; // if not last, remove relax-end and peak-relax stages
                    let maxDuration = 0;
                    let maxRelax = 0;
                    for( let b = 0; b < result.length; ++b ){
                        let bml = result[b];
                        if( !isNaN( bml.start ) ){ bml.start += time; }
                        if( !isNaN( bml.ready ) ){ bml.ready += time; }
                        if( !isNaN( bml.attackPeak ) ){ bml.attackPeak += time; }
                        if( !isNaN( bml.relax ) ){ 
                            if ( maxRelax < bml.relax ){ maxRelax = bml.relax; } 
                            bml.relax += time;  
                        }
                        if( !isNaN( bml.end ) ){ 
                            if ( maxDuration < bml.end ){ maxDuration = bml.end; } 
                            bml.end += time; 
                        }
                    }
                    orders = orders.concat( result );
                    time += maxDuration; // time up to last end

                    peakRelaxDuration = 0;
                    relaxEndDuration = maxDuration - maxRelax;
                }
                else if ( gloss.type == "sigml" ){ // SiGML
                    time = time - relaxEndDuration - peakRelaxDuration; // if not last, remove relax-end and peak-relax stages
                    let result = sigmlStringToBML( gloss.data, time );
                    orders = orders.concat(result.data);
                    time += result.duration; 
                    peakRelaxDuration = result.peakRelaxDuration;
                    relaxEndDuration = result.relaxEndDuration;
                }
                else{
                    // TODO DEFAULT SKIPPING SIGN MESSAGE
                    time += 3; continue; 
                }
            }catch(e){ console.log( "parse error: " + gloss ); time += 3; }
        }

        // give the orders to the avatar controller 
        let msg = {
            type: "behaviours",
            data: orders
        };
        this.msg = JSON.parse(JSON.stringify(msg)); // make copy
        this.ECAcontroller.processMsg( msg );

        return { msg: msg, duration: time - delayTime, peakRelaxDuration: peakRelaxDuration, relaxEndDuration: relaxEndDuration }; // duration
    }

    onMessage(data, callback){
        if ( !data || !Array.isArray(data) ) {
            return;
        }

        this.ECAcontroller.reset();
        this.processMessageRawBlocks( data ).then((processedData)=>{ 
            if(callback) {
                callback(processedData);
            }          
        } );          
    };

    setIntensity(value) {
        this.intensity = value;
        if(this.mixer && this.mixer._actions.length) {
            this.mixer._actions[0].setEffectiveWeight(value);
            this.mixer.update(0);
    
        let bones = this.ECAcontroller.originalSkeleton.bones;
        
        for( let i = 0; i < bones.length; ++i ){
            this.baseSkeleton.bones[i].position.copy(bones[i].position);
            this.baseSkeleton.bones[i].quaternion.copy(bones[i].quaternion);
            this.baseSkeleton.bones[i].scale.copy(bones[i].scale);
        }
        
        this.baseSkeleton.bones[0].updateWorldMatrix( false, true ); // assume 0 is root. Update all global matrices (root does not have any parent)          
        this.baseSkeleton.calculateInverses();
        }
    }
}


export { quadraticBezierVec3, cubicBezierVec3, mirrorQuat, mirrorQuatSelf, nlerpQuats, getTwistSwingQuaternions, getTwistQuaternion, stringToDirection, findIndexOfBone, findIndexOfBoneByName, getBindQuaternion, forceBindPoseQuats, BehaviourManager, BehaviourPlanner, Blink, FacialExpr, FacialEmotion, GazeManager, Gaze, HeadBML, Lipsync, Text2LipInterface, T2LTABLES, HandShape, ExtfidirPalmor, LocationBodyArm, HandConstellation, DirectedMotion, CircularMotion, FingerPlay, WristMotion, ElbowRaise, ShoulderRaise, ShoulderHunch, BodyMovement, CharacterController, FacialController, BodyController, GeometricArmIK, sigmlStringToBML, TIMESLOT, ScriptApp} 
