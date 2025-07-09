import { Performs } from './js/Performs.js'
import { LX } from 'lexgui'
import 'lexgui/components/videoeditor.js';
import * as THREE from 'three'
import { DrawingUtils, HandLandmarker, FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13';

let runningMode = "IMAGE";
// let handLandmarker = null;

// const performs = new Performs();
// performs.init({srcReferencePose: 2, trgReferencePose: 2, restrictView: false});
// performs.changeMode(Performs.Modes.KEYFRAME);
// window.global = {app: performs};

const avatars = {
    "EvaLow": [Performs.AVATARS_URL+'Eva_Low/Eva_Low.glb', Performs.AVATARS_URL+'Eva_Low/Eva_Low.json', 0, Performs.AVATARS_URL+'Eva_Low/Eva_Low.png'],
    "Witch": [Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.glb', Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.json', 0, Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.png'],
    "Kevin": [Performs.AVATARS_URL+'Kevin/Kevin.glb', Performs.AVATARS_URL+'Kevin/Kevin.json', 0, Performs.AVATARS_URL+'Kevin/Kevin.png'],
    "Ada": [Performs.AVATARS_URL+'Ada/Ada.glb', Performs.AVATARS_URL+'Ada/Ada.json',0, Performs.AVATARS_URL+'Ada/Ada.png'],
    "Eva": ['https://models.readyplayer.me/66e30a18eca8fb70dcadde68.glb', Performs.AVATARS_URL+'ReadyEva/ReadyEva_v3.json',0, 'https://models.readyplayer.me/66e30a18eca8fb70dcadde68.png?background=68,68,68'],
    "Victor": ['https://models.readyplayer.me/66e2fb40222bef18d117faa7.glb', Performs.AVATARS_URL+'ReadyVictor/ReadyVictor.json',0, 'https://models.readyplayer.me/66e2fb40222bef18d117faa7.png?background=68,68,68']
}

class App {
    constructor() {
        
        // Mapping data
        this.animationMap = null;
        this.characters = avatars;
        this.speed = 1;
        this.loop = false;

        // DOM elements
        this.characterCanvas = null;
        this.videoCanvas = null;
        this.sceneCanvas = null;
        this.video = null;
        
        this.delayedResizeTime = 500; //ms
        this.delayedResizeID = null;

        // Mediapipe
        this.applyMediapipe = false;
        this.show3DLandmarks = false;

        this.handLandmarker = null;
        this.drawingVideoUtils = null;
        this.drawingCharacterUtils = null;

        // 3D mediapipe scene
        this.mediapipeScene = {
            scene: new THREE.Scene(),
            renderer: null,
            leftHandPoints: new THREE.Group(),
            rightHandPoints: new THREE.Group()
        }
        
        // Init performs (character )
        this.performs = new Performs();
        this.performs.init({srcReferencePose: 2, trgReferencePose: 2, restrictView: false, onReady: () => { this.init() }});
        this.performs.changeMode(Performs.Modes.KEYFRAME);
   
    }

    async init() {
        const response = await fetch( "animations.json" );
        if( response.ok ) {
            this.animationsMap = await response.json();
        }

        await this.createGUI();
        this.createMediapipeScene();
        
        this.drawingVideoUtils = new DrawingUtils( this.videoCanvas.getContext("2d") );
        this.drawingCharacterUtils = new DrawingUtils( this.characterCanvas.getContext("2d") );

        this.delayedResize(this.characterCanvas.parentElement.clientWidth, this.characterCanvas.parentElement.clientHeight);

        await this.initMediapipe();
    }

    async createGUI() {
        const mainArea = await LX.init({});
        const [menubar, containerArea] = mainArea.split({type: "vertical", sizes: ["200px", "auto"]});
        const [leftArea, rightArea] = containerArea.split({sizes: ["50%", "auto"]});
        
        // ------------------------------------------------- Menu -------------------------------------------------
        const buttonsPanel = menubar.addPanel( {className: "m-6", width: "50%"});            
        buttonsPanel.addTitle("Select a video", {style: { background: "none"}});

        buttonsPanel.sameLine();
        const values = Object.keys(this.animationsMap);
        buttonsPanel.addSelect("SL Video", values, null, async (signName, event) => {
            
            const response = await fetch( this.animationsMap[signName] );
            if( response.ok ) {
                const data = await response.text();
            
                this.performs.keyframeApp.loadFiles( [ {name: this.animationsMap[signName], data}] , ( animationName ) => {
                    // Show canvas after animation loaded
                    this.characterCanvas.classList.remove("hidden");
                    this.videoCanvas.classList.remove("hidden");
                    this.sceneCanvas.classList.remove("hidden");
                    this.video.classList.remove("hidden");
                    
                    // Hide info
                    document.getElementById("select-video").classList.add("hidden");

                    this.loadVideo( signName, animationName );                   
                })
            }
        }, { filter: true, overflowContainerY: containerArea.root, width: "40%"});           
        
        
        buttonsPanel.addNumber("Speed", this.speed, (v) => {
            this.speed = v;
            this.video.playbackRate = v;
            this.performs.currentCharacter.mixer.timeScale = v;
        }, {min: 0, max: 2, step: 0.01, width: "40%" });
        
        buttonsPanel.addToggle("Loop", this.loop, (v) => {
            this.loop = v;           
        });
        buttonsPanel.endLine();
        
        const charactersInfo = [];
        
        for(let character in this.characters) {
            charactersInfo.push( { value: character, src: this.characters[character][3]} );
        }
        
        buttonsPanel.addSelect("Characters", charactersInfo, charactersInfo[0].value, async (value, event) => {
            $('#loading').fadeIn();
            this.performs.loadAvatar(this.characters[value][0], this.characters[value][1] , new THREE.Quaternion(), value, () => {
                this.performs.changeAvatar( value );
                const mixer = this.performs.currentCharacter.mixer;
                mixer.setTime(this.video.currentTime)
                
                $('#loading').fadeOut(); //hide();               
            }, (err) => {
                $('#loading').fadeOut();
                alert("There was an error loading the character", "Character not loaded");
            } );
        }, { filter: true, overflowContainerY: containerArea.root, width: "80%"})
        
        buttonsPanel.sameLine();
        buttonsPanel.addToggle("Apply Mediapipe", this.applyMediapipe, (v) => {
            this.applyMediapipe = v;
          
        }, { width: "40%" })

        const toggle = buttonsPanel.addToggle("Show 3D Landmarks", this.show3DLandmarks, (v) => {
            if( !this.applyMediapipe && v) {
                LX.popup("You have to enable Mediapipe to show 3D landmarks!");
                toggle.set(false)
                return;
            }
            this.show3DLandmarks = v;
        }, { width: "40%" })
        buttonsPanel.endLine();

        // ------------------------------------------------- Reference sign area -------------------------------------------------
        this.video = document.createElement('video');
        this.video.style="width:100%;position:absolute;";
        this.video.className="hidden";
        this.video.controls = true;
        leftArea.attach(this.video);
        leftArea.root.style.position = "relative";
        
        // Show mediapipe 2D landmarks in canvas 2D
        this.videoCanvas = document.createElement('canvas');
        this.videoCanvas.style="width:100%;position:absolute;";
        this.videoCanvas.className="hidden";
        this.videoCanvas.style.pointerEvents = "none";
        leftArea.attach(this.videoCanvas);
        
        this.performs.renderer.domElement.style="width:100%;position:absolute;";
        const info = document.createElement('div');
        info.id = "select-video";
        info.innerText = "Select a video to start";
        info.classList = "p-6 text-center text-xxl ";

        leftArea.attach(info);

        // ------------------------------------------------- Character area -------------------------------------------------
        this.characterCanvas = document.createElement('canvas');
        this.characterCanvas.style="width:100%;position:absolute;";
        this.characterCanvas.className="hidden";
        this.characterCanvas.style.pointerEvents = "none";
        
        // Show mediapipe 3D landmarks using threejs
        this.sceneCanvas = document.createElement('canvas');
        this.sceneCanvas.style="width:100%;position:absolute;";
        this.sceneCanvas.className="hidden";
        this.sceneCanvas.style.pointerEvents = "none";
        
        // const container = LX.makeContainer(["auto", "auto"], "", `<video id="video" class="hidden" controls style="width:100%;position:absolute;"></video><canvas id="reference-mediapipe-canvas" class="hidden" style="width:100%;position:absolute;"></canvas>`, leftArea);
        // container.style.position = "relative";        
        rightArea.attach(this.performs.renderer.domElement); // three js character
        rightArea.attach(this.characterCanvas); // 2D landmarks drawing
        rightArea.attach(this.sceneCanvas); // three js 3D landmarks
        rightArea.root.style.position = "relative";
        rightArea.onresize = (bounding) => this.delayedResize(bounding.width, bounding.height);
    }

    async loadVideo( signName, animationName ) {
        
        const landmarksDataUrl = 'https://catsl.eelvex.net/static/vid_data/teacher-' + signName + '/teacher-' + signName + '_keyframe_1.json';        
        this.video.src = `https://catsl.eelvex.net/static/vid/teacher-${signName}.mp4`;
        
        this.video.onloadeddata = async (e) => { 
        
            this.videoCanvas.width =  this.video.videoWidth;
            this.videoCanvas.height = this.video.videoHeight;
            this.video.currentTime = 0.0;

            this.performs.keyframeApp.onChangeAnimation(animationName, true);
            this.performs.keyframeApp.changePlayState(false);
                     
            // Load reference landmarks of the video
            try {
                const response = await fetch( landmarksDataUrl );
                if( response.ok ) {
                    const landmarksData = await response.json();
                    this.originalLandmarks = landmarksData;
                    const landmarks = landmarksData[0].landmarks;
                    if(landmarks) {
                        // landmarks.map(landmark => {
                        //     return {
                        //         x: 1 - landmark.x,
                        //         y: landmark.y,
                        //         visibility: landmark.visibility
                        //     };
                        // });
                        this.drawingVideoUtils.drawConnectors( landmarks, HandLandmarker.HAND_CONNECTIONS, {color: '#1a2025', lineWidth: 4}); //'#00FF00'
                        this.drawingVideoUtils.drawLandmarks( landmarks, {color: '#1a2025',fillColor: 'rgba(255, 255, 255, 1)', lineWidth: 2}); //'#00FF00'
                    
                    }
                }
                else {
                    this.originalLandmarks = null;
                }
            }
            catch( err ) {
                this.originalLandmarks = null;
            }
            requestAnimationFrame(this.animate.bind(this));                             
        }
        
        this.video.onplay = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            this.performs.keyframeApp.changePlayState(!this.video.paused);
            mixer.setTime(this.video.currentTime);
        }

        this.video.onpause = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            this.performs.keyframeApp.changePlayState(!this.video.paused);
            mixer.setTime(this.video.currentTime);
        }

        this.video.ontimeupdate = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            if( this.video.paused ) {
                mixer.setTime(this.video.currentTime);
            }
        }

        this.video.onended = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            mixer.setTime(0);
            this.performs.keyframeApp.changePlayState(false);
            if( this.loop ) {
                this.video.currentTime = 0;
                this.video.play();
            }
        }
    }

    createMediapipeScene() {

        const geometry = new THREE.SphereGeometry( 1, 10, 10 );
        const material = new THREE.MeshBasicMaterial( { color: 0xffff00 } );
        const sphere = new THREE.Mesh( geometry, material ); 
        sphere.scale.set(0.01, 0.01, 0.01);
        
        for(let i = 0; i < 21; i++) { // mediapipe hand bones
            this.mediapipeScene.leftHandPoints.add( sphere.clone() );
            this.mediapipeScene.rightHandPoints.add( sphere.clone() );
        }

        this.mediapipeScene.scene.add(this.mediapipeScene.leftHandPoints);
        this.mediapipeScene.scene.add(this.mediapipeScene.rightHandPoints);
        this.mediapipeScene.renderer = new THREE.WebGLRenderer({canvas: this.sceneCanvas, alpha: true});
        this.mediapipeScene.renderer.setSize( window.innerWidth, window.innerHeight );
    }
    
    async initMediapipe () {
        const vision = await FilesetResolver.forVisionTasks( "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm" );
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: runningMode,
            numHands: 2
        });
    }

    // Waits until delayedResizeTime to actually resize webGL. New calls reset timeout. To avoid slow resizing and crashes.
    delayedResize( width, height ) {
        if ( this.delayedResizeID ) {
            clearTimeout(this.delayedResizeID); this.delayedResizeID = null;
        }
        this.delayedResizeID = setTimeout( () => { this.delayedResizeID = null; this.resize(width, height); }, this.delayedResizeTime );

        this.resize(width, height);
    }

    resize( width, height ) {
        for (let i = 0; i < this.performs.cameras.length; i++) {
            this.performs.cameras[i].aspect = width / height;
            this.performs.cameras[i].updateProjectionMatrix();
        }
        this.performs.renderer.setSize( width, height );
        this.mediapipeScene.renderer.setSize( width, height );                    

        this.characterCanvas.width = width;
        this.characterCanvas.height = height;
        const canvasCtx = this.characterCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);
    }

    async animate() {
        
        this.mediapipeScene.leftHandPoints.visible = false;
        this.mediapipeScene.rightHandPoints.visible = false;
        
        const canvasCtx = this.characterCanvas.getContext('2d'); 
        canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);

        if( this.applyMediapipe ) {

            // Convert 3D canvas ( three scene ) into image to send it to Mediapipe
            const bitmap = await createImageBitmap(this.performs.renderer.domElement);
                       
            const detectionsHand = this.handLandmarker.detect(bitmap);
            bitmap.close();
            if (detectionsHand.landmarks.length) {
                const originalLandmarks = this.originalLandmarks ? this.originalLandmarks[0].landmarks : null;
                const originalData = this.originalLandmarks ? this.originalLandmarks[0].handedness : "";
                let index = originalData.indexOf("index=") + 6;
                index = Number(originalData[index]);
                // Draw 2D landmarks
                for (let j = 0; j < detectionsHand.landmarks.length; j++) {
                    const detectedLandmarks = detectionsHand.landmarks[j];
                // for (const detectedLandmarks of detectionsHand.landmarks) {
                    let smoothingFactor = 1;
                    if (this.prevLandmarks) {
                        for (let i = 0; i < detectedLandmarks.length; i++) {
                            detectedLandmarks[i].x = smoothingFactor * detectedLandmarks[i].x + (1 - smoothingFactor) * this.prevLandmarks[i].x;
                            detectedLandmarks[i].y = smoothingFactor * detectedLandmarks[i].y + (1 - smoothingFactor) * this.prevLandmarks[i].y;
                        }
                    }
                    
                    let color = "gray"
                    if(index == j) {
                        const transformed = transformLandmarks(originalLandmarks, detectedLandmarks);
                        const score = scoreLandmarks(transformed, detectedLandmarks);
                        color = scoreToColor(score);
                        this.drawingCharacterUtils.drawConnectors(transformed, HandLandmarker.HAND_CONNECTIONS, { color: "#f0f0f0", lineWidth: 2 });
                        this.drawingCharacterUtils.drawLandmarks(transformed, { color: 'purple', lineWidth: 2 });
                    }
                    this.prevLandmarks = detectedLandmarks;
                    this.drawingCharacterUtils.drawConnectors(detectedLandmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#f0f0f0", lineWidth: 2 });
                    this.drawingCharacterUtils.drawLandmarks(detectedLandmarks, { color: color, lineWidth: 2 });
                }

                if( this.show3DLandmarks ) {
                    // Draw 3D landmarks (update points positions)
                    for (let j = 0; j < detectionsHand.worldLandmarks.length; j++ ) {
                        const hand = detectionsHand.handedness[j][0].categoryName;
                        let hand3D = null;
                        if(hand == "Right") {
                            hand3D = this.performs.scene.getObjectByName(`mixamorig_LeftHand`) || this.performs.scene.getObjectByName(`LeftHand`);
                        }
                        else {
                            hand3D = this.performs.scene.getObjectByName(`mixamorig_RightHand`) || this.performs.scene.getObjectByName(`RightHand`);
                        }
                        
                        let pos = new THREE.Vector3();
                        if(hand3D) {
                            hand3D.getWorldPosition(pos);                 
                        }
                        
                        const detectedLandmarks = detectionsHand.worldLandmarks[j];                         
                        for (let i = 0; i < detectedLandmarks.length; i++) {
                            if(hand == "Left") {
                                this.mediapipeScene.leftHandPoints.visible = true;
                                this.mediapipeScene.leftHandPoints.children[i].position.x = pos.x +(detectedLandmarks[i].x - detectedLandmarks[0].x);
                                this.mediapipeScene.leftHandPoints.children[i].position.y = pos.y -(detectedLandmarks[i].y - detectedLandmarks[0].y);
                                this.mediapipeScene.leftHandPoints.children[i].position.z = pos.z -(detectedLandmarks[i].z - detectedLandmarks[0].z);                       
                            }
                            else {
                                this.mediapipeScene.rightHandPoints.visible = true;
                                this.mediapipeScene.rightHandPoints.children[i].position.x = pos.x +(detectedLandmarks[i].x - detectedLandmarks[0].x);
                                this.mediapipeScene.rightHandPoints.children[i].position.y = pos.y -(detectedLandmarks[i].y - detectedLandmarks[0].y);
                                this.mediapipeScene.rightHandPoints.children[i].position.z = pos.z -(detectedLandmarks[i].z - detectedLandmarks[0].z);                        
                            }
                        }
                    }                        
                }
            }
    
            this.mediapipeScene.renderer.render(this.mediapipeScene.scene, this.performs.cameras[this.performs.camera]);
        }
        requestAnimationFrame(this.animate.bind(this));
    }
}

const transformLandmarks = (originalLandmarks, newLandmarks) => {
    // Assume originalLandmarks and newLandmarks are arrays of landmarks
    // and originalLandmarks[0] and newLandmarks[0] are the wrists
    originalLandmarks = flipLandmarks(originalLandmarks);

    // Scale
    let axis0 = 0;
    let axis1 = 5;
    let scale = Math.sqrt(Math.pow(newLandmarks[axis0].x - newLandmarks[axis1].x, 2) + Math.pow(newLandmarks[axis0].y - newLandmarks[axis1].y, 2)) /
    Math.sqrt(Math.pow(originalLandmarks[axis0].x - originalLandmarks[axis1].x, 2) + Math.pow(originalLandmarks[axis0].y - originalLandmarks[axis1].y, 2));
    axis0 = 5;
    axis1 = 17;
    let scale2 = Math.sqrt(Math.pow(newLandmarks[axis0].x - newLandmarks[axis1].x, 2) + Math.pow(newLandmarks[axis0].y - newLandmarks[axis1].y, 2)) /
        Math.sqrt(Math.pow(originalLandmarks[axis0].x - originalLandmarks[axis1].x, 2) + Math.pow(originalLandmarks[axis0].y - originalLandmarks[axis1].y, 2));
    if (scale2 > scale) {
    scale = scale2;
    }

    // Apply scaling
    let scaledLandmarks = originalLandmarks.map(landmark => {
    let dx = landmark.x - originalLandmarks[0].x;
    let dy = landmark.y - originalLandmarks[0].y;
    return {
        x: originalLandmarks[0].x + dx * scale,
        y: originalLandmarks[0].y + dy * scale,
        visibility: landmark.visibility
    };
    });

    // Compute rotation angle for each joint and apply rotation
    let rotatedLandmarks = scaledLandmarks.map((landmark, index) => {
    let dx = landmark.x - scaledLandmarks[0].x;
    let dy = landmark.y - scaledLandmarks[0].y;
    let distance = Math.sqrt(dx*dx + dy*dy);

    // Compute rotation angle for this joint
    let angleOriginal = Math.atan2(originalLandmarks[index].y - originalLandmarks[0].y, originalLandmarks[index].x - originalLandmarks[0].x);
    let angleNew = Math.atan2(newLandmarks[index].y - newLandmarks[0].y, newLandmarks[index].x - newLandmarks[0].x);
    let dAngle = angleNew - angleOriginal;

    // If dAngle is within the maximum rotation angle, use it, otherwise use the maximum rotation angle
    let maxTheta = Math.PI * 0.025;
    let rotationAngle = Math.abs(dAngle) <= maxTheta ? dAngle : Math.sign(dAngle) * maxTheta;

    // Apply rotation to this joint
    return {
        x: scaledLandmarks[0].x + distance * Math.cos(angleOriginal + rotationAngle),
        y: scaledLandmarks[0].y + distance * Math.sin(angleOriginal + rotationAngle),
        visibility: landmark.visibility
    };
    });


    // Create an array to hold the adjusted landmarks
    let adjustedLandmarks = [];

    // Process each landmark in order
    for (let index = 0; index < rotatedLandmarks.length; index++) {
    let landmark = rotatedLandmarks[index];

    if (index === 0 || index === 1 || index === 5 || index === 9 || index === 13 || index === 17) {
        // No need to adjust for the wrist or the bases of the fingers
        adjustedLandmarks.push(landmark);
    } else {
        // Only adjust for the tips of the fingers
        // if ([3,4,7,8,11,12,15,16,19,20].includes(index)) {
        // Calculate the original distance from the current joint to the tip
        let rotatedDistance = Math.sqrt(Math.pow(landmark.x - rotatedLandmarks[index - 1].x, 2) + Math.pow(landmark.y - rotatedLandmarks[index - 1].y, 2));

        // Calculate the direction from the joint to the tip
        let dx = landmark.x - rotatedLandmarks[index - 1].x;
        let dy = landmark.y - rotatedLandmarks[index - 1].y;

        // Normalize the direction
        let length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;

        // Scale the direction by the original distance
        let desiredDistance = Math.min(rotatedDistance, 3.1 * length);
        dx *= desiredDistance;
        dy *= desiredDistance;

        // Add the scaled direction to the joint's position to get the new position for the tip
        adjustedLandmarks.push({
            x: rotatedLandmarks[index - 1].x + dx,
            y: rotatedLandmarks[index - 1].y + dy,
            visibility: landmark.visibility
        });
        // } else {
        // adjustedLandmarks.push(landmark);
        // }
    }
    }
    // Apply translation
    let transformedLandmarks = adjustedLandmarks.map(landmark => {
    return {
        x: landmark.x + newLandmarks[0].x - adjustedLandmarks[0].x,
        y: landmark.y + newLandmarks[0].y - adjustedLandmarks[0].y,
        visibility: landmark.visibility
    };
    });


    return transformedLandmarks;
}

function flipLandmarks(landmarks) {
    // Flip the x-coordinates of the landmarks
    return landmarks.map(landmark => {
	return {
	    x: 1 - landmark.x,
	    y: landmark.y,
	    visibility: landmark.visibility
	};
    });
}

function scoreLandmarks(landmarks1, landmarks2) {
    const numLandmarks = landmarks1.length;

    let score = 0;

    for (let i = 0; i < numLandmarks; i++) {
	// distance between corresponding landmarks
	const dx = landmarks1[i].x - landmarks2[i].x;
	const dy = landmarks1[i].y - landmarks2[i].y;
	const distance = Math.sqrt(dx * dx + dy * dy);

	// Calculate the weight for this landmark, decreasing outwords from the wrist (0):
	// 0 - 1 - 2 - 3 - 4 
	// 0 - 5 - 6 - 7 - 8
	// 0 - 9 - 10 - 11 - 12
	// 0 - 13 - 14 - 15 - 16
	// 0 - 17 - 18 - 19 - 20
	let relativeIndex = (i === 0) ? 0 : 4 - ((i - 1) % 4);
	// Penalize thumb landmarks more
	if (i === 3 || i === 4) {
	    relativeIndex -= 0.5;
	}
	const weight = 1 / (1 + relativeIndex);

	// Add the weighted distance to the score
	score += weight * distance;

	// Penalize thumb general direction match
	if (i >= 1 && i <= 4) {
	    const thumbDirection1 = {
		x: landmarks1[i].x - landmarks1[i - 1].x,
		y: landmarks1[i].y - landmarks1[i - 1].y
	    };
	    const thumbDirection2 = {
		x: landmarks2[i].x - landmarks2[i - 1].x,
		y: landmarks2[i].y - landmarks2[i - 1].y
	    };

	    // Dot product to measure similarity in direction
	    const dotProduct = thumbDirection1.x * thumbDirection2.x + thumbDirection1.y * thumbDirection2.y;
	    const magnitude1 = Math.sqrt(thumbDirection1.x * thumbDirection1.x + thumbDirection1.y * thumbDirection1.y);
	    const magnitude2 = Math.sqrt(thumbDirection2.x * thumbDirection2.x + thumbDirection2.y * thumbDirection2.y);
	    const directionSimilarity = dotProduct / (magnitude1 * magnitude2);

	    // Penalize based on the difference in direction
	    const directionPenalty = Math.pow(1 - directionSimilarity, 2);
	    // console.log("Score: " + score);
	    // console.log("Direction penalty: " + directionPenalty);
	    score += directionPenalty * weight;
	}
	
    }

    return score;
}

function scoreToColor(score) {
    let maxScore = 0.35;
    score = Math.max(0, Math.min(maxScore, score));
    let value = score / maxScore;
    let green = Math.floor((1 - value) * 255);
    let red = Math.floor(value * 255);
    return `rgb(${red}, ${green}, 0)`;
}


const app = new App();
    
window.global = {app};