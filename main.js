import { Performs } from './js/performs/Performs.js'
import { LX } from 'lexgui'
// import 'lexgui/extensions/videoeditor.js';
import './js/lexgui/videoeditor.js'
import * as THREE from 'three'
import { DrawingUtils, HandLandmarker, PoseLandmarker, FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13';

import { transformLandmarks, flipLandmarks, scoreLandmarks, scoreToColor } from './js/feedbackHelper.js'
import { TrajectoriesHelper } from './js/trajectoriesHelper.js'

let runningMode = "IMAGE";

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
        
        this.selectedVideo = null;

        this.startTimeString = 0;

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
        this.performs.init({srcReferencePose: 2, trgReferencePose: 2, color: "#0B0B0C", restrictView: false, onReady: () => { this.init() }});
        this.performs.changeMode(Performs.Modes.KEYFRAME);
        this.performs.controls[this.performs.camera].target.set(-0.0018097140234495583, 1.2244433704429296, 0.003067399741162387);

        this.camera = this.performs.cameras[this.performs.camera].clone();

        
        window.addEventListener( 'resize', this.onWindowResize.bind(this) );
    }

    onWindowResize() {
        const width = this.characterCanvas.parentElement.clientWidth;
        const height = this.characterCanvas.parentElement.clientHeight;
        this.resize(width, height);
    }

    async init() {
        const response = await fetch( "animations.json" );
        if( response.ok ) {
            this.animationsMap = await response.json();
        }

        
        this.assetData = [];
        for(let name in this.animationsMap) {
           this.assetData.push( { id: name, type: "video", path: "teacher-video-Ψ.mp4" }); //`https://catsl.eelvex.net/static/vid/teacher-${name}.mp4`
        }

        this.trajectoriesHelper = new TrajectoriesHelper(  this.performs.currentCharacter.model,  this.performs.currentCharacter.mixer );

        await this.createGUI();
        this.createMediapipeScene();

        this.drawingVideoUtils = new DrawingUtils( this.videoCanvas.getContext("2d") );
        this.drawingCharacterUtils = new DrawingUtils( this.characterCanvas.getContext("2d") );

        this.delayedResize(this.characterCanvas.parentElement.clientWidth, this.characterCanvas.parentElement.clientHeight);

    }

    async createGUI() {
        const mainArea = await LX.init({});
        let menubar = null;

        const localHost = window.location.protocol !== "https:";
        const starterTheme = LX.getTheme();
        const menubarButtons = [
            {
                title: "Change Theme",
                icon: starterTheme == "dark" ? "Moon" : "Sun",
                swap: starterTheme == "dark" ? "Sun" : "Moon",
                callback:  (value, event) => { 
                    LX.switchTheme();
                    if( value == "dark" ) {
                        this.window.backgroundColor = "rgba(200, 200, 255, 0.15)";
                        this.window.handlerColor = "whitesmoke";
                    }
                    else {
                        this.window.backgroundColor = "rgba(200, 200, 255, 0.52)";
                        this.window.handlerColor = "#3e4360ff";
                    }
                    this.videoEditor.timebar._draw(); }
            },
            {
                title: "Switch Spacing",
                icon: "AlignVerticalSpaceAround",
                callback:  (value, event) => { LX.switchSpacing() }
            }
        ];

        const avatarMenu = [
            { name: "Character", icon: "PersonStanding@solid" },
            { name: "Detect landmakrs", checked: true, icon: "HandsAslInterpreting@solid" },
        ];

        if( this.applyMediapipe) {
            avatarMenu.push( { name: "Show 2D landmarks", checked: this.show2DLandmarksAvatar, icon: "Waypoints@solid" } );
            avatarMenu.push( { name: "Show 3D landmarks", checked: this.show3DLandmarks, icon: "Waypoints@solid" } );
        }

        menubar = mainArea.addMenubar();
        // menubar = mainArea.addMenubar(
        // [
        //     { name: "Video", submenu: [
        //         { name: "Video source", icon: "FileVideo@solid", callback: () => {
        //              const assetView = new LX.AssetView();
        //              assetView.load( this.assetData, ( e ) => {
        //                 switch( e ) {
        //                     case AssetViewEvent.ASSET_SELECTED:
        //                         break;
        //                     case AssetViewEvent.ASSET_DELETED:
        //                         break;
        //                     case AssetViewEvent.ASSET_RENAMED:
        //                         break;
        //                     case AssetViewEvent.ASSET_CLONED:
        //                         break;
        //                     case AssetViewEvent.ASSET_DBLCLICKED:
        //                         break;
        //                     case AssetViewEvent.ASSET_CHECKED:
        //                         break;
        //                     case AssetViewEvent.ENTER_FOLDER :
        //                         break;
        //                 }
        //             } );
        //         } },
        //         { name: "Show 2D landmarks", checked: this.show2DLandmarksVideo, icon: "Waypoints@solid" },
        //     ] },
        //     { name: "Avatar", submenu: avatarMenu },
        //     { name: "View", submenu: [
        //         { name: "Background color", icon: "Palette" },
        //         { name: "Color of 2D landmarks", icon: "Palette" },
        //         { name: "Color of 3D landmarks", icon: "Palette" }
        //     ]
                
        //     }
        // ]
        // );
        menubar.addButtons( menubarButtons );
        menubar.setButtonImage("Vista-SL", '/imgs/vistasl.png', () => {window.open("http://xanthippi.ceid.upatras.gr/VistaSL/EN/VistaSL.html")}, {float: "left"})
        menubar.setButtonIcon("Github", "Github", () => { window.open("https://github.com/upf-gti/vista-sl/") });
        
        // const videoDialog = new LX.Dialog("Title", p => {
        //     // Start adding components
        //     p.addNumber("Example", 18);
        // }, options);

        const [panels, containerArea] = mainArea.split({type: "vertical", sizes: ["240px", "auto"]});
        const [topContainer, bottomContainer] = containerArea.split({type: "vertical", sizes: ["80%", "auto"]});
        const [leftArea, rightArea] = topContainer.split({sizes: ["50%", "auto"]});
        const [videoMenu, sceneMenu] = panels.split({sizes: ["50%", "auto"]});
        const videoPanel = videoMenu.addPanel( {className: "m-6", width: "calc(100% - 3rem)"});
        const scenePanel = sceneMenu.addPanel( {className: "m-6", width: "calc(100% - 3rem)"});
       
        const refresh = () => {
            // ------------------------------------------------- Video Menu -------------------------------------------------
            videoPanel.clear();

            videoPanel.addTitle("Visualize generated animation from video", {style: { background: "none"}});

            videoPanel.sameLine();
            const values = Object.keys(this.animationsMap);
            videoPanel.addSelect("SL Video", values, this.selectedVideo, async (signName, event) => {
                this.selectedVideo = signName;
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
                            const animation = this.performs.keyframeApp.bindedAnimations[animationName][this.performs.currentCharacter.model.name];
                            this.trajectoriesHelper.computeTrajectories(animation);
                        })
                        this.buildAnimation = false;
                    }
                    else {
                        this.buildAnimation = true;
                    }
                    refresh();
                }
                catch( err ) {
                    this.buildAnimation = true;
                }
            }, { filter: true, overflowContainerY: containerArea.root, width: "40%"});

            videoPanel.endLine();

            videoPanel.addColor("Reference 2D landmarks", this.referenceColor, (v) => {
                this.referenceColor = v;
                const landmarks = this.originalLandmarks[0].landmarks;
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
                }
            },  { nameWidth: "200px", width: "40%" });

            // ------------------------------------------------- Scene Menu -------------------------------------------------
            scenePanel.clear();
            const charactersInfo = [];

            for(let character in this.characters) {
                charactersInfo.push( { value: character, src: this.characters[character][3]} );
            }
            scenePanel.addSelect("Character", charactersInfo, this.performs.currentCharacter ? this.performs.currentCharacter.model.name : charactersInfo[0].value, async (value, event) => {
                $('#loading').fadeIn();
                this.performs.loadAvatar(this.characters[value][0], this.characters[value][1] , new THREE.Quaternion(), value, () => {
                    this.performs.changeAvatar( value );
                    this.trajectoriesHelper.object = this.performs.currentCharacter.model;
                    const animation = this.performs.keyframeApp.bindedAnimations[this.performs.keyframeApp.currentAnimation][this.performs.currentCharacter.model.name];
                    let boneName = null;
                    for(let i = 0; i < animation.mixerBodyAnimation.tracks.length; i++) {
                        const track = animation.mixerBodyAnimation.tracks[i]
                        const trackName = track.name;
                        for(let trajectory in this.trajectoriesHelper.trajectories) {
                            
                            if(trackName.includes(trajectory+".") || trackName.includes(trajectory.replace("4","EndSite")+".")) {
                                boneName = trackName.replace(".quaternion", "");
                                if(boneName) {
                                    this.trajectoriesHelper.trajectories[trajectory].name = boneName;
                                    break;
                                }
                            }
                        }
                    }
                    
                    const mixer = this.performs.currentCharacter.mixer;
                    mixer.setTime(this.video.currentTime);
                    
                    const track = animation.mixerBodyAnimation.tracks[0];
                    this.trajectoriesHelper.trajectoryEnd = track.times.length;
                    this.trajectoriesHelper.mixer = mixer;
                    this.trajectoriesHelper.computeTrajectories(animation);

                    $('#loading').fadeOut(); //hide();
                }, (err) => {
                    $('#loading').fadeOut();
                    alert("There was an error loading the character", "Character not loaded");
                } );
            }, { filter: true, overflowContainerY: containerArea.root, width: "80%"})

            scenePanel.addColor("Background", {r: this.performs.scene.background.r, g: this.performs.scene.background.g, b: this.performs.scene.background.b } , (v) => {
                this.performs.setBackPlaneColour(v);
            },  { nameWidth: "200px", width: "40%" });

            scenePanel.sameLine();
            scenePanel.addToggle("Apply Mediapipe", this.applyMediapipe, async (v) => {
                this.applyMediapipe = v;
                if( !this.handLandmarker ) {
                    await this.initMediapipe();
                }

            }, { nameWidth: "200px", width: "40%" })

            scenePanel.addColor("Detected 3D landmarks", this.detectedColor, (v) => {
                this.detectedColor = v;
            },  { nameWidth: "200px", width: "40%" });

            scenePanel.endLine();
            const toggle = scenePanel.addToggle("Show 3D Landmarks", this.show3DLandmarks, (v) => {
                if( !this.applyMediapipe && v) {
                    LX.popup("You have to enable Mediapipe to show 3D landmarks!");
                    toggle.set(false)
                    return;
                }
                this.show3DLandmarks = v;
            }, { nameWidth: "200px", width: "40%" })

            if(this.selectedVideo) {
                scenePanel.addButton(null, "Open trajectories dialog", () => {
                    this.showTrajectoriesDialog();
                }, { width: "40%"} );
            }
        }
        refresh();

        // ------------------------------------------------- Reference sign area -------------------------------------------------
        this.video = document.createElement('video');
        this.video.style="width:100%;position:absolute;";
        this.video.className="hidden";
        this.video.controls = false;
        leftArea.attach(this.video);
        leftArea.root.style.position = "relative";

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

        this.videoEditor = new LX.VideoEditor(leftArea, {  video: this.video, controlsArea: bottomContainer })

        this.videoEditor.hideControls();

        this.videoEditor.onSetTime = (t) => {
            this.window.moveWindow( t );
            this.trajectoriesHelper.updateTrajectories( this.window.start, this.window.end );
        }

        this.videoEditor.onChangeSpeed = (v) => {
                this.speed = v;
                const mixer = this.performs.currentCharacter.mixer;
                const animDuration = mixer._actions[0]._clip.duration;

                if( this.video.currentTime < animDuration ) {
                    mixer.timeScale = v;
                }                
        }

        this.window = new Window( this.videoEditor.timebar, { start: 0, end: 1, resizingLeft: true, resizingRight: true} );
        this.videoEditor.timebar.onMouse = ( e ) => this.window.onMouse( e );
        this.videoEditor.timebar.onDraw = () => this.window.draw();
        this.window.onChangeStart = ( startTime ) => {
            this.trajectoriesHelper.updateTrajectories( this.window.start, this.window.end );;
        }
        this.window.onChangeEnd = ( endTime ) => {
            this.trajectoriesHelper.updateTrajectories( this.window.start, this.window.end );;
        }
        this.window.onHover = ( e ) => {
            const x = e.target.offsetLeft + e.offsetX;
            const y = e.target.offsetTop - 70;
            if( !this.popup ) {
                this.popup = LX.popup("Time window to adjust trajectory frames shown.", null, { position: [x, y] });
            }
        }
        
        // Show mediapipe 2D landmarks in canvas 2D
        this.videoCanvas = document.createElement('canvas');
        this.videoCanvas.style="position:absolute;";
        this.videoCanvas.className="hidden";
        this.videoCanvas.style.pointerEvents = "none";
        leftArea.attach(this.videoCanvas);
    }

    showTrajectoriesDialog() {

        const dialog = new LX.Dialog("Trajectories", (p) => {

            const trajectories = this.trajectoriesHelper.trajectories;

            let leftValue = true;
            let rightValue = true;

            const leftTrajectories = {};
            const rightTrajectories = {};
            for(let trajectory in trajectories) {
                if(trajectory.includes("Left")) {
                    leftTrajectories[trajectory] = trajectories[trajectory];
                }
                else {
                    rightTrajectories[trajectory] = trajectories[trajectory];
                }
            }
            const area = new LX.Area({className: "flex flex-row"});
            const leftHand = new LX.Panel();
            const refreshLeft = () => {
                leftHand.clear();
                leftHand.branch("Left Hand");
                leftHand.addToggle(`Show all`, leftValue, (v) => {
                    for(let trajectory in leftTrajectories) {
                        trajectories[trajectory].visible = v;
                    }
                    leftValue = v;
                    refreshLeft();
                });
                for(let trajectory in leftTrajectories) {
                    leftHand.addSeparator();
                    leftHand.sameLine(2);
                    const t = leftHand.addToggle(`Show ${trajectory}`, trajectories[trajectory].visible, (v) => { trajectories[trajectory].visible = v; }, {nameWidth: "170px"})
                    t.root.getElementsByTagName("input")[0].style.backgroundColor = trajectories[trajectory].color ? trajectories[trajectory].color.getHexString() : null;
                    leftHand.addNumber("Width", trajectories[trajectory].thickness, (v) => {
                        trajectories[trajectory].thickness = v;
                        trajectories[trajectory].getObjectByName("line").material.linewidth = v;
                    }, {min: 1, max: 30, width: "150px"});

                }
            }
            refreshLeft();

            const rightHand = new LX.Panel();
            const refreshRight = () => {
                rightHand.clear();
                rightHand.branch("Right Hand");
                rightHand.addToggle(`Show all`, rightValue, (v) => {
                    for(let trajectory in rightTrajectories) {
                        trajectories[trajectory].visible = v;
                    }
                    rightValue = v;
                    refreshRight();
                });
                for(let trajectory in rightTrajectories) {
                    rightHand.addSeparator();
                    rightHand.sameLine(2);
                    const t = rightHand.addToggle(`Show ${trajectory}`, trajectories[trajectory].visible, (v) => { trajectories[trajectory].visible = v;}, {nameWidth: "170px"})
                    t.root.getElementsByTagName("input")[0].style.backgroundColor = trajectories[trajectory].color ? trajectories[trajectory].color.getHexString() : null;

                    rightHand.addNumber("Width", trajectories[trajectory].thickness, (v) => {
                        trajectories[trajectory].thickness = v;
                        trajectories[trajectory].getObjectByName("line").material.linewidth = v;
                    }, {min: 1, max: 30, width: "150px"});

                }
            }
            refreshRight();
            area.attach(leftHand);
            area.attach(rightHand);
            p.attach(area);

        }, {size:["50%", "auto"], draggable: true, })
    }
   
    async loadVideo( signName ) {

        $('#text').innerText = "Loading video..."
        $('#loading').fadeIn();
        const landmarksDataUrl = 'https://catsl.eelvex.net/static/vid_data/teacher-' + signName + '/teacher-' + signName + '_keyframe_1.json';
        this.video.src = "teacher-video-Ψ.mp4";//`https://catsl.eelvex.net/static/vid/teacher-${signName}.mp4`;

        const canvasCtx = this.characterCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);

        this.video.onloadedmetadata = async (e) => {

            this.video.currentTime = 0.0;
            this.video.loop = this.videoEditor.loop;
            this.video.classList.remove("hidden");
            // const videoAspect =  this.video.clientHeight / this.video.videoHeight;
            const videoAspect = this.video.videoHeight/this.video.videoWidth;
            const offset = this.video.clientHeight/ this.video.videoHeight;
            this.videoCanvas.height = this.video.clientHeight;
            this.videoCanvas.width =  this.video.videoWidth*offset;
            this.videoCanvas.classList.remove("hidden");

            $('#loading').fadeOut();
            $('#text').innerText = "Loading character..."

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
            this.videoEditor.showControls();
            this.videoEditor.loadVideo({controls: true});
            requestAnimationFrame(this.animate.bind(this));
        }

        this.video.onplay = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            this.performs.keyframeApp.changePlayState(!this.video.paused);
            mixer.timeScale = 1;
            mixer.setTime(this.video.currentTime);
            mixer.timeScale = this.speed;
            // this.video.currentTime = this.videoEditor.startFrame;
        }

        this.video.onpause = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            this.performs.keyframeApp.changePlayState(!this.video.paused);

            if(this.video.currentTime >= this.videoEditor.endTime && this.videoEditor.loop) {
                // this.video.currentTime = this.videoEditor.startTime;
                // this.video.play();
                this.performs.keyframeApp.changePlayState(!this.video.paused);
            }
            // else {

            //     mixer.timeScale = 1;
            // }
            //mixer.setTime(this.video.currentTime);
        }

        this.video.ontimeupdate = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            if( !mixer._actions.length ) {
                return;
            }
            const animDuration = mixer._actions[0]._clip.duration;
            if( this.video.paused ) {
                mixer.timeScale = 1;
                const time = Math.min(this.video.currentTime, animDuration);
                mixer.setTime(time);
            }
            else {
                if( this.video.currentTime >= animDuration ) {
                    mixer.timeScale = 0;
                }
                else if( mixer.timeScale == 0) {
                    mixer.timeScale = this.speed;
                    mixer.setTime(this.video.currentTime);
                }
            } 

        }

        this.video.onended = (e) => {
            const mixer = this.performs.currentCharacter.mixer;
            mixer.setTime(this.videoEditor.startTime);
            this.performs.keyframeApp.changePlayState(false);
            if( this.videoEditor.loop ) {
                this.video.pause();
                this.video.currentTime = this.videoEditor.startTime;
                this.video.play();
            }
        }
    }

    createMediapipeScene() {

        const geometry = new THREE.SphereGeometry( 1, 10, 10 );
        const material = new THREE.MeshBasicMaterial( { color: this.detectedColor } );
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

    async animate( dt ) {

        this.mediapipeScene.leftHandPoints.visible = false;
        this.mediapipeScene.rightHandPoints.visible = false;

        const canvasCtx = this.characterCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);

        if( this.applyMediapipe && this.handLandmarker) {

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

                    let color = 'red'; //this.detectedColor;
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
                                this.mediapipeScene.leftHandPoints.children[i].material.color.set(this.detectedColor);
                                this.mediapipeScene.leftHandPoints.children[i].position.x = pos.x +(detectedLandmarks[i].x - detectedLandmarks[0].x);
                                this.mediapipeScene.leftHandPoints.children[i].position.y = pos.y -(detectedLandmarks[i].y - detectedLandmarks[0].y);
                                this.mediapipeScene.leftHandPoints.children[i].position.z = pos.z -(detectedLandmarks[i].z - detectedLandmarks[0].z);
                            }
                            else {
                                this.mediapipeScene.rightHandPoints.visible = true;
                                this.mediapipeScene.rightHandPoints.children[i].material.color.set(this.detectedColor);
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

        this.trajectoriesHelper.updateTrajectories( this.window.start, this.window.end );

        requestAnimationFrame(this.animate.bind(this));
    }
}

const app = new App();

class Window {
    constructor( timeline, options = {} ) {
        this.timeline = timeline;
        this.timeline.padding = 0;

        this.start = options.start != undefined ? options.start : 0.0; // sec
        this.end = options.end || 3.0;   // sec
        this.center = options.center != undefined ? options.center : this.start

        this.canvas = this.timeline.canvas;
        this.windowHeight = options.windowHeight || this.canvas.height - 15;
        this.handleWidth = options.handleWidth || 6;
        
        this.allowDragging = options.dragging ?? false;
        this.dragging = false;
        this.dragOffset = 0;
        this.resizingLeft = false;
        this.resizingRight = false;

        this.backgroundColor = options.backgroundColor || "rgba(200, 200, 255, 0.15)";
        this.handlerColor = options.handlerColor || "whitesmoke";
    }

    draw() {
        const ctx = this.canvas.getContext('2d');
        let startX = Math.max( this.timeline.startX, this.timeline.timeToX(this.start) );
        let endX = Math.min( this.timeline.endX, this.timeline.timeToX(this.end) );
        const width = endX - startX;

        // Window background
        ctx.fillStyle = this.backgroundColor;
        ctx.roundRect(startX - 2, this.canvas.height / 2 - this.windowHeight / 2, width, this.windowHeight, 5);
        ctx.fill();
        // Border
        ctx.strokeStyle = "rgba(200, 200, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(startX - 2, this.canvas.height / 2 - this.windowHeight / 2, width, this.windowHeight, 5);
        ctx.stroke();

        // Handlers
        const offsetW = 2;
        const offsetH = 8;
        if( startX > this.timeline.startX ) {
            ctx.fillStyle = this.handlerColor;//"#579aff";
            ctx.fillRect(startX - 2, this.canvas.height / 2 - this.windowHeight / 2, this.handleWidth, this.windowHeight);
            ctx.fillStyle = "#579aff";
            ctx.fillRect(startX + this.handleWidth / 2 - offsetW  /2 - 2, this.canvas.height / 2 - this.windowHeight / 2 + offsetH / 2 , offsetW, this.windowHeight - offsetH);
        }
        if( endX < this.timeline.endX ) {
            ctx.fillStyle = this.handlerColor; //"#579aff";
            ctx.fillRect(endX - this.handleWidth + 2, this.canvas.height / 2 - this.windowHeight / 2, this.handleWidth, this.windowHeight);
            ctx.fillStyle = "#579aff";   
            ctx.fillRect(endX - this.handleWidth / 2 - offsetW / 2 + 2, this.canvas.height / 2 - this.windowHeight / 2 + offsetH / 2, offsetW, this.windowHeight - offsetH);       
        }
    }

    onMouse( e ) {
        switch(e.type) {
            case "mousedown":
                this.onMouseDown( e );
                break;
            case "mousemove":
                this.onMouseMove( e );
                break;
            case "mouseup":
                this.onMouseUp( e );
                break;
        }
    }

    onMouseDown( e ) {
        const x = e.offsetX;
        const startX = this.timeline.timeToX(this.start);
        const endX = this.timeline.timeToX(this.end);

        if( x >= startX && x <= startX + this.handleWidth ) {
            this.resizingLeft = true;
            e.cancelBubble = true;
        }
        else if( x >= endX - this.handleWidth && x <= endX ) {
            this.resizingRight = true;
            e.cancelBubble = true;
        }
        else if( this.allowDragging &&  x >= startX && x <= endX ) {
            this.dragging = true;
            this.dragOffset = x - startX;
            e.cancelBubble = true;
        }
    }

    onMouseMove( e ) {
        const x = e.offsetX;
        let startX = this.timeline.timeToX(this.start);
        let endX = this.timeline.timeToX(this.end);
        const centerX = this.timeline.timeToX(this.center);
        if( this.resizingLeft ) {
            startX = Math.min( centerX, Math.max( this.timeline.startX, x ) );//Math.max(startX - 0.1, (x - this.timeline.padding) / (this.canvas.width - 2 * this.timeline.padding) * this.timeline.endX);
            this.start = this.timeline.xToTime( startX );
            if( this.onChangeStart ) {
                this.onChangeStart( this.start );
            }
        }
        else if( this.resizingRight ) {
            endX = Math.max( centerX, Math.min( this.timeline.endX, x ) ); //Math.min(endX + 0.1, (x - this.timeline.padding) / (this.canvas.width - 2 * this.timeline.padding) * this.timeline.endX);
            this.end = this.timeline.xToTime( endX );
            if( this.onChangeEnd ) {
                this.onChangeEnd( this.end );
            }
        }
        else if( this.dragging ) {
            const time = this.timeline.xToTime( x - this.dragOffset );
            this.moveWindow( time );
            this.canvas.style.cursor = "grabbing";
        }
        else {
            const x = e.offsetX;
            const y = e.offsetY;

            const startX = this.timeline.timeToX(this.start);
            const endX = this.timeline.timeToX(this.end);

            if( !this.timeline.dragging && x >= startX && x <= startX + this.handleWidth && y -2  >= this.canvas.height / 2 - this.windowHeight / 2 && y <= this.windowHeight ) {
                this.canvas.style.cursor = "col-resize";
                e.cancelBubble = true;
                if( !this.resizingLeft && this.onHover ) {
                    this.onHover( e );
                }
            }
            else if( !this.timeline.dragging && x >= endX - this.handleWidth && x <= endX && y -2 >= this.canvas.height / 2 - this.windowHeight / 2 && y <= this.windowHeight ) {
                this.canvas.style.cursor = "col-resize";
                e.cancelBubble = true;
                if( !this.resizingRight && this.onHover ) {
                    this.onHover( e );
                }
            }
            return;
        }
        e.cancelBubble = true;
        this.timeline._draw();
    }

    onMouseUp( e ) {
        this.dragging = false;
        this.resizingLeft = false;
        this.resizingRight = false;
    }

    moveWindow( time ) {

        const leftOffset = this.start - this.center;
        const rightOffset = this.end - this.center;

        this.start = time + leftOffset;
        this.end = time + rightOffset;
        this.center = time;
    }

}
window.global = {app};