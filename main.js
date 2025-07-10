import { Performs } from './js/Performs.js'
import { LX } from 'lexgui'
import 'lexgui/components/videoeditor.js';
import * as THREE from 'three'
import { DrawingUtils, HandLandmarker, PoseLandmarker, FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13';

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
        
        this.referenceColor = '#800080';
        this.detectedColor =  '#383838';

        // GUI actions
        this.applyMediapipe = false;
        this.show3DLandmarks = false;
        this.buildAnimation = true;
        
        this.delayedResizeTime = 500; //ms
        this.delayedResizeID = null;
        
        // Data provided
        this.originalLandmarks = null;
        this.originalLandmarks3D = [];
        
        // Mediapipe
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
        this.performs.controls[this.performs.camera].target.set(-0.0018097140234495583, 1.2244433704429296, 0.003067399741162387);
        
        this.camera = this.performs.cameras[this.performs.camera].clone();

        // this.performs.controls[this.performs.camera].addEventListener('change', (v) => {
        //     const hAngle = this.performs.controls[this.performs.camera].getAzimuthalAngle();
        //     const VAngle = this.performs.controls[this.performs.camera].getPolarAngle();
            
        //     for(let i = 0; i < this.originalLandmarks3D.length; i++ ) {
        //         let landmark2D = this.originalLandmarks3D[i].clone();
        //         landmark2D.z = 1 - landmark2D.z;
        //         landmark2D.applyAxisAngle(new THREE.Vector3(0,1,0), hAngle);
        //         landmark2D.applyAxisAngle(new THREE.Vector3(1,0,0), -VAngle);
        //         landmark2D.project(this.camera);
        //         this.originalLandmarks[0].landmarks[i].x = landmark2D.x;
        //         this.originalLandmarks[0].landmarks[i].y = landmark2D.y;
        //         this.originalLandmarks[0].landmarks[i].z = landmark2D.z;
        //     }
        // })
   
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
        const [menubar, containerArea] = mainArea.split({type: "vertical", sizes: ["240px", "auto"]});
        const [leftArea, rightArea] = containerArea.split({sizes: ["50%", "auto"]});
        
        // ------------------------------------------------- Menu -------------------------------------------------
        const buttonsPanel = menubar.addPanel( {className: "m-6", width: "50%"});
        buttonsPanel.addTitle("Visualize generated animation from video", {style: { background: "none"}});

        buttonsPanel.sameLine();
        const values = Object.keys(this.animationsMap);
        buttonsPanel.addSelect("SL Video", values, null, async (signName, event) => {
            this.loadVideo( signName );           
            try {
                const response = await fetch( this.animationsMap[signName] );
                if( response.ok ) {
                    const data = await response.text();
                
                    this.performs.keyframeApp.loadFiles( [ {name: this.animationsMap[signName], data}] , ( animationName ) => {
                        // Show canvas after animation loaded
                        this.characterCanvas.classList.remove("hidden");
                        this.sceneCanvas.classList.remove("hidden");
                        
                        this.performs.keyframeApp.onChangeAnimation(animationName, true);
                        this.performs.keyframeApp.changePlayState(false);
    
                    })
                    this.buildAnimation = false;
                }
                else {
                    this.buildAnimation = true;
                }    
            }
            catch( err ) {
                this.buildAnimation = true;
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
                mixer.setTime(this.video.currentTime);
                this.performs.currentCharacter.mixer.timeScale = this.speed;
                
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

        buttonsPanel.sameLine();
        buttonsPanel.addColor("Reference 2D landmarks", this.referenceColor, (v) => {
            this.referenceColor = v;
        },  { width: "40%" });

        buttonsPanel.addColor("Detected 2D landmarks", this.detectedColor, (v) => {
            this.detectedColor = v;
        },  { width: "40%" });
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

        this.debugCanvas = document.createElement('canvas');
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

    async loadVideo( signName ) {
        
        const landmarksDataUrl = 'https://catsl.eelvex.net/static/vid_data/teacher-' + signName + '/teacher-' + signName + '_keyframe_1.json';        
        this.video.src = `https://catsl.eelvex.net/static/vid/teacher-${signName}.mp4`;
        const canvasCtx = this.characterCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);

        this.video.onloadeddata = async (e) => { 
        
            this.videoCanvas.width =  this.video.videoWidth;
            this.videoCanvas.height = this.video.videoHeight;
            this.video.currentTime = 0.0;
            
            this.videoCanvas.classList.remove("hidden");
            this.video.classList.remove("hidden");
            
            // Hide info
            document.getElementById("select-video").classList.add("hidden");
            this.originalLandmarks = null;
            this.originalLandmarks3D = [];
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
                        this.drawingVideoUtils.drawLandmarks( landmarks, {color: this.referenceColor , fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'

                        for(let i = 0; i < landmarks.length; i++) {
                            let landmark3D = new THREE.Vector3(landmarks[i].x, landmarks[i].y, landmarks[i].z);
                            landmark3D.unproject(this.camera)
                            this.originalLandmarks3D.push(landmark3D);
                        }
                    
                    }
                }
                else {
                    LX.popup("No mediapipe landmarks available for this video");
                    this.originalLandmarks = null;
                }
            }
            catch( err ) {
                try {
                    const response = await fetch( 'https://resources.gti.upf.edu/vista-resources/teacher-' + signName + '_keyframe_1.json' );
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
                            this.drawingVideoUtils.drawLandmarks( landmarks, {color: this.referenceColor, fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'
                        
                        }
                    }
                    else {
                        LX.popup("No mediapipe landmarks available for this video");
                    }
                }
                catch( err ) {
                    LX.popup("No mediapipe landmarks available for this video");
                    this.originalLandmarks = null;
                }
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

        this.poseLandmarker = await PoseLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                    delegate:"GPU"
                },
                runningMode: runningMode//"VIDEO"//runningMode,
            // minTrackingConfidence: 0.001,
            // minPosePresenceConfidence: 0.001,
            // minPoseDetectionConfidence: 0.001
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
                    
                    let color = this.detectedColor;
                    if(index == detectionsHand.handedness[j][0].index) {
                        
                        let transformed = transformLandmarks(flipLandmarks(originalLandmarks), detectedLandmarks);
                        const score = scoreLandmarks(transformed, detectedLandmarks);
                        color = scoreToColor(score);
                        this.drawingCharacterUtils.drawConnectors(transformed, HandLandmarker.HAND_CONNECTIONS, { color:  '#1a2025', lineWidth: 2 });
                        this.drawingCharacterUtils.drawLandmarks(transformed, { color: this.referenceColor, lineWidth: 2 });
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

        if(this.buildAnimation) {
            // this.debugCanvas.height = this.video.videoHeight;
            // this.debugCanvas.width  = this.video.videoWidth;
            // this.video.parentElement.prepend(this.debugCanvas)
            // const ctx = this.debugCanvas.getContext("2d");
            // ctx.drawImage(this.video, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
            // const bitmap = await createImageBitmap(this.debugCanvas);
            // const detectedLandmarks = this.poseLandmarker.detect(bitmap);
            // bitmap.close();
            // createBodyAnimationFromWorldLandmarks( detectedLandmarks.worldLandmarksArray, this.performs.currentCharacter.skeleton )
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


// Array of objects. Each object is a frame with all world landmarks. See mediapipe.js detections
function createBodyAnimationFromWorldLandmarks( worldLandmarksArray, skeleton ){
    function getTwistQuaternion( q, normAxis, outTwist ){
        let dot =  q.x * normAxis.x + q.y * normAxis.y + q.z * normAxis.z;
        outTwist.set( dot * normAxis.x, dot * normAxis.y, dot * normAxis.z, q.w )
        outTwist.normalize(); // already manages (0,0,0,0) quaternions by setting identity
        return outTwist;
    }

    function computeSpine( skeleton, bindQuats, bodyLandmarks ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)

        const boneHips = skeleton.bones[ 0 ];
        boneHips.quaternion.copy( bindQuats[ 0 ] );
        const boneSpine0 = skeleton.bones[ 1 ]; // connected to hips
        boneSpine0.quaternion.copy( bindQuats[ 1 ] );
        const boneSpine1 = skeleton.bones[ 2 ];
        boneSpine1.quaternion.copy( bindQuats[ 2 ] );
        const boneSpine2 = skeleton.bones[ 3 ];
        boneSpine2.quaternion.copy( bindQuats[ 3 ] );
        const boneLeftLeg = skeleton.bones[ 57 ]; // connected to hips
        const boneRightLeg = skeleton.bones[ 62 ]; // connected to hips


        boneHips.updateWorldMatrix( true, true );

        const landmarkHipsLeft = bodyLandmarks[ 23 ];
        const landmarkHipsRight = bodyLandmarks[ 24 ];
        const landmarkShoulderLeft = bodyLandmarks[ 11 ];
        const landmarkShoulderRight = bodyLandmarks[ 12 ];
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

    function computeQuatHead( skeleton, bindQuats, bodyLandmarks ){
        if ( !bodyLandmarks ){ return; }
        //bodyLandmarks is an array of {x,y,z,visiblity} (mediapipe)

        let tempVec3 = new THREE.Vector3();
        let qq = new THREE.Quaternion();

        const boneHead = skeleton.bones[ 5 ]; // head
        boneHead.quaternion.copy( bindQuats[ 5 ] );
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
        let earsDirPred = (new THREE.Vector3()).subVectors( bodyLandmarks[8], bodyLandmarks[7] ).normalize();
        let earNoseDirPred = (new THREE.Vector3()).subVectors( bodyLandmarks[0], bodyLandmarks[7] ).normalize();
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

    function computeQuatArm( skeleton, bodyLandmarks, isLeft = false ){
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
            let landmarkSrc = bodyLandmarks[ landmarks[i] ];
            let landmarkTrg = bodyLandmarks[ landmarks[i+1] ];
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

    function computeQuatHand( skeleton, handLandmarks, isLeft = false ){
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
        mcMidPred.subVectors( handLandmarks[9], handLandmarks[0] ); // world
        mcMidPred.applyQuaternion( invWorldQuat ).normalize(); // hand local space
        
        //swing (with unwanted twist)
        let dirBone = boneMid.position.clone().normalize();
        let qq = new THREE.Quaternion();
        qq.setFromUnitVectors( dirBone, mcMidPred );
        boneHand.quaternion.multiply( qq );
        invWorldQuat.premultiply( qq.invert() ); // update hand's world to local quat

        // twist
        let mcPinkyPred = (new THREE.Vector3()).subVectors( handLandmarks[17], handLandmarks[0] );
        let mcIndexPred = (new THREE.Vector3()).subVectors( handLandmarks[5], handLandmarks[0] );
        let palmDirPred = (new THREE.Vector3()).crossVectors(mcPinkyPred, mcIndexPred).normalize(); // world space
        palmDirPred.applyQuaternion( invWorldQuat ).normalize(); // local space
        let palmDirBone = (new THREE.Vector3()).crossVectors(bonePinky.position, boneIndex.position).normalize(); // local space. Cross product "does not care" about input sizes
        qq.setFromUnitVectors( palmDirBone, palmDirPred ).normalize();
        boneHand.quaternion.multiply( qq ).normalize();
    }

    /* TODO
        Consider moving the constraints direclty into the mediapipe landmarks. 
        This would avoid unnecessary recomputations of constraints between different characters.
        Changes would be baked already in the mediapipe landmarks
    */       
    function computeQuatPhalange( skeleton, bindQuats, handLandmarks, isLeft = false ){
        if ( !handLandmarks ){ return; }
        //handlandmarks is an array of {x,y,z,visiblity} (mediapipe)

        const bonePhalanges = isLeft ? 
        [ 13,14,15,16,    17,18,19,20,    21,22,23,24,    25,26,27,28,    29,30,31,32 ] :
        [ 53,54,55,56,    49,50,51,52,    45,46,47,48,    41,42,43,44,    37,38,39,40 ];

        let tempVec3_1 = new THREE.Vector3();
        let tempVec3_2 = new THREE.Vector3();
        const invWorldQuat = new THREE.Quaternion();

        tempVec3_1.subVectors(handLandmarks[5], handLandmarks[0]).normalize();
        tempVec3_2.subVectors(handLandmarks[17], handLandmarks[0]).normalize();
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
            tempVec3_1.subVectors(handLandmarks[f+1], handLandmarks[f+0]).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            const fingerBend = handNormal.dot(tempVec3_1);
            tempVec3_1.subVectors(handLandmarks[f+2], handLandmarks[f+1]).normalize();
            meanSideDeviation += handSide.dot(tempVec3_1) * 1/3;
            tempVec3_1.subVectors(handLandmarks[f+3], handLandmarks[f+2]).normalize();
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
                boneSrc.quaternion.copy( bindQuats[ bonePhalanges[ f+i-1 ] ] );
                boneSrc.updateWorldMatrix( true, false );
            
                // world mediapipe phalange direction
                let v_phalange = new THREE.Vector3();
                v_phalange.subVectors( handLandmarks[landmark+1], handLandmarks[landmark] ).normalize();

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

    skeleton.pose(); // bind pose

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
        let body = worldLandmarksArray[i].PWLM;
        let rightHand = worldLandmarksArray[i].RWLM;
        let leftHand = worldLandmarksArray[i].LWLM;

        computeSpine( skeleton, bindQuats, body );
        computeQuatHead( skeleton, bindQuats, body );

        // right arm-hands
        computeQuatArm( skeleton, body, false );
        computeQuatHand( skeleton, rightHand, false); 
        computeQuatPhalange( skeleton, bindQuats, rightHand, false );
        
        // left arm-hands
        computeQuatArm( skeleton, body, true );
        computeQuatHand( skeleton, leftHand, true ); 
        computeQuatPhalange( skeleton, bindQuats, leftHand, true );

        // remove hips delta rotation from legs (children of hips). Hardcoded for EVA 
        skeleton.bones[62].quaternion.copy( skeleton.bones[0].quaternion ).invert().multiply( bindQuats[0] ).multiply( bindQuats[62] );
        skeleton.bones[57].quaternion.copy( skeleton.bones[0].quaternion ).invert().multiply( bindQuats[0] ).multiply( bindQuats[57] );

        // store skeleton quat values
        // for( let j = 0; j < skeleton.bones.length; ++j ){
        //     tracks[j].set( skeleton.bones[j].quaternion.toArray(), i * 4 );
        // }

        // // store timing
        // if (i != 0){ timeAcc += worldLandmarksArray[i].dt/1000; }
        // times[i] = timeAcc;  
    }

    // // for each bone create a quat track
    // for( let i = 0; i < skeleton.bones.length; ++i ){
    //     tracks[i] = new THREE.QuaternionKeyframeTrack( skeleton.bones[i].name + ".quaternion", times.slice(), tracks[i] );
    // }

    // return new THREE.AnimationClip( "animation", -1, tracks );
}

const app = new App();
    
window.global = {app};