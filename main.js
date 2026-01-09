import { Performs } from './js/performs/Performs.js'
import { LX } from 'lexgui'
// import 'lexgui/extensions/VideoEditor.js';
import 'lexgui/extensions/AssetView.js';

import './js/lexgui/videoeditor.js'
import * as THREE from 'three'
import { DrawingUtils, HandLandmarker, PoseLandmarker, FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13';

import { transformLandmarks, flipLandmarks, scoreLandmarks, scoreToColor } from './js/feedbackHelper.js'
import { TrajectoriesHelper } from './js/trajectoriesHelper.js'
import { Visualizer } from './js/visualizer.js';
import Stats from 'https://cdnjs.cloudflare.com/ajax/libs/stats.js/r17/Stats.min.js'
import { AnimationRetargeting, applyTPose } from './js/retargeting.js'
import { MediaPipe } from './js/mediapipe.js';
const stats = Stats()
document.body.appendChild(stats.dom)
let runningMode = "IMAGE";

// const avatars = {
//     "EvaLow": [Performs.AVATARS_URL+'Eva_Low/Eva_Low.glb', Performs.AVATARS_URL+'Eva_Low/Eva_Low.json', 0, Performs.AVATARS_URL+'Eva_Low/Eva_Low.png'],
//     "Witch": [Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.glb', Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.json', 0, Performs.AVATARS_URL+'Eva_Witch/Eva_Witch.png'],
//     "Kevin": [Performs.AVATARS_URL+'Kevin/Kevin.glb', Performs.AVATARS_URL+'Kevin/Kevin.json', 0, Performs.AVATARS_URL+'Kevin/Kevin.png'],
//     "Ada": [Performs.AVATARS_URL+'Ada/Ada.glb', Performs.AVATARS_URL+'Ada/Ada.json',0, Performs.AVATARS_URL+'Ada/Ada.png'],
//     "Eva": ['https://models.readyplayer.me/66e30a18eca8fb70dcadde68.glb', Performs.AVATARS_URL+'ReadyEva/ReadyEva_v3.json',0, 'https://models.readyplayer.me/66e30a18eca8fb70dcadde68.png?background=68,68,68'],
//     "Victor": ['https://models.readyplayer.me/66e2fb40222bef18d117faa7.glb', Performs.AVATARS_URL+'ReadyVictor/ReadyVictor.json',0, 'https://models.readyplayer.me/66e2fb40222bef18d117faa7.png?background=68,68,68']
// }


const avatars = [
    { id: "EvaLow", src: `${Performs.AVATARS_URL}Eva_Low/Eva_Low.glb`, config: `${Performs.AVATARS_URL}Eva_Low/Eva_Low.json`, type: "object", metadata: { preview: `${Performs.AVATARS_URL}Eva_Low/Eva_Low.png` } },
    { id: "Witch", src: `${Performs.AVATARS_URL}Eva_Witch/Eva_Witch.glb`, config: `${Performs.AVATARS_URL}Eva_Witch/Eva_Witch.json`, type: "object", metadata: { preview: `${Performs.AVATARS_URL}Eva_Witch/Eva_Witch.png` } },
    { id: "Kevin", src: `${Performs.AVATARS_URL}Kevin/Kevin.glb`, config: `${Performs.AVATARS_URL}Kevin/Kevin.json`, type: "object", metadata: { preview: `${Performs.AVATARS_URL}Kevin/Kevin.png` } },
    { id: "Ada", src: `${Performs.AVATARS_URL}Ada/Ada.glb`, config: `${Performs.AVATARS_URL}Ada/Ada.json`, type: "object", metadata: { preview: `${Performs.AVATARS_URL}Ada/Ada.png` } },
    { id: "Eva", src: `https://models.readyplayer.me/66e30a18eca8fb70dcadde68.glb`, config: `${Performs.AVATARS_URL}ReadyEva/ReadyEva_v3.json`, type: "object", metadata: { preview: `https://models.readyplayer.me/66e30a18eca8fb70dcadde68.png` } },
    { id: "Victor", src:`https://models.readyplayer.me/66e2fb40222bef18d117faa7.glb`, config: `${Performs.AVATARS_URL}ReadyVictor/ReadyVictor.json`, type: "object", metadata: { preview: `https://models.readyplayer.me/66e2fb40222bef18d117faa7.png` } }
]

class App {
    constructor() {

        this.mode = App.modes.VIDEO;
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
        this.show2DLandmarksVideo = false;
        this.show2DLandmarksAvatar = false;
        this.show3DLandmarks = false;
        this.showTrajectories = true;

        this.delayedResizeTime = 500; //ms
        this.delayedResizeID = null;
        
        // Data provided
        this.originalLandmarks = null;
        this.originalLandmarks3D = [];
        
        // Mediapipe
        this.mediapipe = null;
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
        this.buildAnimation = true;
        
        // Init performs (character )
        this.performs = new Performs();
        this.performs.init({srcReferencePose: 2, trgReferencePose: 2, color: "#0B0B0C", restrictView: false, onReady: () => { this.init() }});
        this.performs.changeMode(Performs.Modes.KEYFRAME);
        this.performs.controls[this.performs.camera].target.set(-0.0018097140234495583, 1.2244433704429296, 0.003067399741162387);

        this.camera = this.performs.cameras[this.performs.camera].clone();

        this.smoothLandmarks = true;
        this.smoothFrameCount = 3;
        this.visualizer = new Visualizer( this.smoothFrameCount );

        window.addEventListener( 'resize', this.onWindowResize.bind(this) );

        window.addEventListener( 'keyup', (e) => { 

            switch(e.code) {
                case 'KeyS':
                    this.smoothLandmarks = !this.smoothLandmarks;
                    console.log("Landmarks smoothed: ", this.smoothLandmarks);
                    break;

                case 'KeyR':
                    this.visualizer.smoothRotations = !this.visualizer.smoothRotations;
                    console.log("Rotations smoothed: ", this.visualizer.smoothRotations);
                    break;

                case 'NumpadAdd': case 'BracketRight':
                    this.smoothFrameCount++;
                    this.visualizer.smoothFrameCount = this.smoothFrameCount;
                    console.log("Frame count: ",  this.smoothFrameCount);
                    break;

                case 'NumpadSubstract': case 'Slash':
                    this.smoothFrameCount--;
                    this.visualizer.smoothFrameCount = this.smoothFrameCount;
                    console.log("Frame count: ",  this.smoothFrameCount);
                    break;

                case 'KeyP':
                    if( e.shiftKey ) {  
                        this.visualizer.p-= 0.01;
                    }
                    else {
                        this.visualizer.p+= 0.01;
                    }
                    console.log(this.visualizer.p);
                    break;

                case 'KeyL':
                    if( e.shiftKey ) {
                        this.visualizer.lambda-=100;
                    }
                    else {
                        this.visualizer.lambda+=100;
                    }
                    console.log(this.visualizer.lambda);
                    break;

                case 'KeyV':
                    this.visualizer.showSkeletons = !this.visualizer.showSkeletons; 
                    this.visualizer.changeVisibility();
                    break;
            }
        })
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

        
        this.assetData = [  { id: "Characters", icon: "PersonStanding", type: "folder", children: avatars }, { id: "Videos", icon: "Film", type: "folder", children: this.animationsMap.data, closed: true }, {id: "Webcam", type: "", metadata: { preview: "https://cdn3d.iconscout.com/3d/premium/thumb/webcam-3d-icon-png-download-9580716.png" }}];
        // for(let name in this.animationsMap) {
        //    this.assetData.push( { id: name, type: "video", src: `https://catsl.eelvex.net/static/vid/teacher-${name}.mp4` }); //`https://catsl.eelvex.net/static/vid/teacher-${name}.mp4` //"teacher-video-Ψ.mp4"
        // }

        this.trajectoriesHelper = new TrajectoriesHelper(  this.performs.currentCharacter.model,  this.performs.currentCharacter.mixer );

        await this.createGUI();
        this.createMediapipeScene();

        this.mediapipe = new MediaPipe(this.videoCanvas);

        this.drawingVideoUtils = new DrawingUtils( this.videoCanvas.getContext("2d") );
        this.drawingCharacterUtils = new DrawingUtils( this.characterCanvas.getContext("2d") );

        this.delayedResize(this.characterCanvas.parentElement.clientWidth, this.characterCanvas.parentElement.clientHeight);
        this.animate();
    }

    async createGUI() {
        const mainArea = await LX.init({});
        let menubar = null;

        const starterTheme = LX.getTheme();
        let colorDialog = null;
        let landmarksDialog = null;
        const menubarButtons = [
            {
                selectable: true,
                selected: true,
                icon: "Folder",
                title: "Assets",
                callback: (v, e) => {
                    if (mainArea.splitExtended) {
                        mainArea.reduce();
                    }
                    else {
                        mainArea.extend();
                    }
                }
            },
            {
                title: "Feedback visualization",
                icon: "Eye",
                callback: (v, e) => {
                    if(landmarksDialog) {
                        landmarksDialog.close();
                        landmarksDialog = null;
                    }
                    else {
                        landmarksDialog = new LX.Dialog( "Feedback visualization", panel => {
    
                            const refresh = () => {
                                panel.clear();
                                panel.addToggle("Video 2D landmarks", this.show2DLandmarksVideo, (v) => {
                                    this.show2DLandmarksVideo = v;
                                    this.draw2DLandmarksVideo();                       
                                }, {});
                                panel.addToggle("Avatar 2D landmarks", this.show2DLandmarksAvatar, async (v) => {
                                    if( !this.handLandmarker ) {
                                        await this.initMediapipe();
                                    }
                                    this.show2DLandmarksAvatar = v;                        
                                }, {});
                                panel.addToggle("Avatar 3D landmarks", this.show3DLandmarks, async (v) => {
                                    if( !this.handLandmarker ) {
                                        await this.initMediapipe();
                                    }
                                    this.show3DLandmarks = v;
                                }, {});
                                
                                panel.addToggle("Show trajectories", this.showTrajectories, async (v) => {
                                    this.showTrajectories = v;
                                    if( v ) {
                                        this.trajectoriesHelper.show();
                                    }
                                    else {
                                        this.trajectoriesHelper.hide();
                                    }
                                    refresh();
                                }, {});

                                if( this.showTrajectories ) {
                                    panel.addButton(null, "Trajectories settings", () => this.showTrajectoriesDialog());
                                }
                            }
                            refresh();

                        }, { position: [ "45%", "80px"]})
                    }
                }
            },
            {
                title: "Change Colors",
                icon: "Palette",
                callback: (v, e) => {
                    if(colorDialog) {
                        colorDialog.close();
                        colorDialog = null;
                    }
                    else {
                        colorDialog = new LX.Dialog( "Color settings", panel => {
    
                            panel.addColor("Background", this.backgroundColor, (v) => {
                                this.backgroundColor = v;                        
                            }, {});
                            panel.addColor("Ground truth 2D landmarks", this.referenceColor, (v) => {
                                this.referenceColor = v;                        
                            }, {});
                            panel.addColor("Detected 3D landmarks", this.detectedColor, (v) => {
                                this.detectedColor = v;
                            }, {});
                            
                        }, { position: [ "45%", "80px"]})
                    }
                }
            },
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
                    this.videoEditor.timebar._draw();
                }
            },
            {
                title: "Help",
                icon: "Info",
                callback:  (value, event) => {
                    tour.begin();
                }
            }
        ];
  
        menubar = mainArea.addMenubar( );
        menubar.addButtons( menubarButtons );
        menubar.setButtonImage("Vista-SL", './imgs/vistasl.png', () => {window.open("http://xanthippi.ceid.upatras.gr/VistaSL/EN/VistaSL.html")}, {float: "left"})
        menubar.setButtonIcon("Github", "Github", () => { window.open("https://github.com/upf-gti/vista-sl/") });
        
        const [containerArea, assetsArea] = mainArea.split({type: "vertical", sizes: ["calc( 100% - 280px )", "280px"]});
 
        const [topContainer, bottomContainer] = containerArea.split({type: "vertical", sizes: ["80%", "auto"], resize: false});
        const [leftArea, rightArea] = topContainer.split({sizes: ["50%", "auto"]});
       
        this.assetView = new LX.AssetView( {
            previewActions: [{name:"Load", callback: ( e ) => { this.loadAsset(e) }}]
        });

        this.assetView.on( "select", async ( event ) => {
            const item = event.items[ 0 ];
            if( item.id == "Webcam" && this.mode != App.modes.CAMERA )
            {
                if( this.trajectoriesHelper )
                {
                    this.trajectoriesHelper.hide();
                }
                await this.prepareWebcamRecording();
                this.mode = App.modes.CAMERA;
            }
            console.log( "selected" );
        } );

        this.assetView.on( "dblClick", ( event ) => {
            const item = event.items[ 0 ];
            console.log( "double clicked" );
            if( item.id == "Webcam" ) return;
            this.loadAsset( item );
        } );

        // Example cancellable event
        // this.assetView.on( "beforeCreateFolder", ( event, resolve ) => {
        //     // Your code
        //     // ...
        //     // If cannot create, nothing to do
        //     // If procede to create folder, call:
        //     resolve();
        // } );

        this.assetView.load( this.assetData );
        assetsArea.attach( this.assetView );

        // ------------------------------------------------- Reference sign area -------------------------------------------------
        this.video = document.createElement('video');
        this.video.style="width:100%;position:absolute;";
        this.video.className="hidden";
        this.video.controls = false;
        leftArea.attach(this.video);
        leftArea.root.style.position = "relative";

        this.performs.renderer.domElement.style="width:100%;position:absolute;cursor:grab;";
    
        const info = document.createElement('div');
        info.id = "select-video";
        info.innerText = "Select a video to start";
        info.classList = "p-6 text-center text-xxl content-center";

        leftArea.attach(info);

        this.debugCanvas = document.createElement('canvas');
        // ------------------------------------------------- Character area -------------------------------------------------
        this.characterCanvas = document.createElement('canvas');
        this.characterCanvas.style="width:100%;position:absolute;";
        this.characterCanvas.className="hidden";
        this.characterCanvas.style.pointerEvents = "none";
        this.characterCanvas.style.cursor = "grab";
        
        // Show mediapipe 3D landmarks using threejs
        this.sceneCanvas = document.createElement('canvas');
        this.sceneCanvas.style="width:100%;position:absolute;";
        this.sceneCanvas.className="hidden";
        this.sceneCanvas.style.pointerEvents = "none";
        this.sceneCanvas.style.cursor = "grab";
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

        const tour = new LX.Tour([
            {
                title: "Welcome to VISTA-SL demo",
                content: "This is the main area where you can visualize the teacher video and the virtual avatar performing the same sign. Select a video from the assets to start.",
                reference: topContainer.root,
                side: "center",
                align: "center"
            },
            {
                title: "Menubar",
                content: "This menubar contains all the main actions and settings for customize the visualization.",
                reference: menubar.root,
                side: "bottom",
                align: "center"
            },
            {
                title: "Videos and avatars browser",
                content: "Press this button to show/hide the Content Browser of the bottom.",
                reference: menubar.buttons["Assets"].root,
                side: "bottom",
                align: "center"
            },
            {
                title: "Feedback visualization",
                content: "Press this button to show/hide feedback settings. Show 2D reference landmakrs in the video or in the avatar or detect real-time 3D lanmarks for the avatar. Configure the animation trajectories.",
                reference: menubar.buttons["Feedback visualization"].root,
                side: "bottom",
                align: "center"
            },
            {
                title: "Change colors",
                content: "Press this button to show/hide color settings. Change the color of the scene background or of the landmarks.",
                reference: menubar.buttons["Change Colors"].root,
                side: "bottom",
                align: "center"
            },
            {
                title: "Change application theme",
                content: "Press this button to change between dark and light theme.",
                reference: menubar.buttons["Change Theme"].root,
                side: "bottom",
                align: "center"
            },
            {
                title: "Assets",
                content: "In this area you can select the video to be reproduced and the avatar you want to perform the sign",
                reference: this.assetView.root,
                side: "top",
                align: "center"
            }
        ], { offset: 8, radius: 12, horizontalOffset: 12, verticalOffset: 4 });
    }

    async loadAsset( item ) {
        if( item.type == "video" ) {
            this.video.srcObject = null;
            this.mode = App.modes.VIDEO;

            const signName = item.id;
            this.selectedVideo = signName;
            await this.loadVideo( signName, item.src );
            $('#text')[0].innerText = "Loading video..."
            $('#loading').fadeIn();
            this.performs.keyframeApp.changePlayState(false);
            this.performs.keyframeApp.mixer.setTime(0);
            if(this.performs.keyframeApp.mixer._actions.length)
            {
                this.performs.keyframeApp.mixer.stopAllAction();
                this.performs.keyframeApp.mixer.uncacheAction(this.performs.keyframeApp.mixer._actions[0]);
                this.performs.keyframeApp.mixer._actions = [];
            }
            if( !item.animation ) {
             
                await this.mediapipe.init();
                this.handLandmarker = this.mediapipe.handDetector;
                this.poseLandmarker = this.mediapipe.poseDetector;
                $('#text')[0].innerText = "Generating animation...";
                $('#loading').fadeTo(0, 0.6);
                this.videoEditor.onVideoLoaded = async () => {
                    // await this.initMediapipe();
                    if( this.buildAnimation ) {
                        setTimeout(async () => {
                            await this.mediapipe.processVideoOffline( this.video, {callback: async ( ) => {
                                const landmarks = this.mediapipe.landmarks;
                                const blendshapes = this.mediapipe.blendshapes;
                                const rawData = this.mediapipe.rawData;
                                if( !this.visualizer.scene ) {
                                    await this.visualizer.init(this.performs.scene, this.performs.currentCharacter, PoseLandmarker.POSE_CONNECTIONS, HandLandmarker.HAND_CONNECTIONS);
                                }
                                
                                const animation = this.visualizer.createBodyAnimationFromWorldLandmarks( landmarks, this.performs.currentCharacter.skeleton )
                                // const animationData = this.visualizer.retargeting.retargetAnimation( animation );
                                this.performs.keyframeApp.loadedAnimations[signName] = {
                                    name: signName,
                                    bodyAnimation: animation ?? new THREE.AnimationClip( "bodyAnimation", -1, [] ),
                                    skeleton: this.performs.currentCharacter.skeleton,
                                    model: this.performs.currentCharacter.model,
                                    type: "glb"
                                };
                                
                                // this.performs.keyframeApp.bindAnimationToCharacter( signName, this.performs.currentCharacter.model.name);
                                this.performs.keyframeApp.onChangeAnimation(signName, true);
                                this.performs.keyframeApp.changePlayState(false);
    
                                this.trajectoriesHelper.mixer = this.performs.keyframeApp.mixer;
                                if( this.performs.keyframeApp.currentAnimation ) {
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
                                    this.trajectoriesHelper.computeTrajectories(animation);
                                }
                                this.video.currentTime = 0;
                                if( this.showTrajectories ) {
                                    this.trajectoriesHelper.show();
                                }
                                else {
                                    this.trajectoriesHelper.hide();
                                }
                                this.videoCanvas.classList.add("hidden");
                                //$('#loading').fadeTo(0.6,1);
                                $('#loading').fadeOut();
                            }} );
                        } ,1000)
                    }
                    
                    // this.mediapipeOnlineEnabler = true;
                }
                return;
            }
            try {
                const response = await fetch( item.animation );
                if( response.ok ) {
                    const data = await response.text();

                    this.performs.keyframeApp.loadFiles( [ {name: item.animation, data}] , ( animationName ) => {
                        // Show canvas after animation loaded
                        this.characterCanvas.classList.remove("hidden");
                        this.sceneCanvas.classList.remove("hidden");

                        this.performs.keyframeApp.onChangeAnimation(animationName, true);
                        this.performs.keyframeApp.changePlayState(false);
                        this.trajectoriesHelper.mixer = this.performs.keyframeApp.mixer;
                        if( this.performs.keyframeApp.currentAnimation ) {
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
                            this.trajectoriesHelper.computeTrajectories(animation);
                        }
                        $('#loading').fadeOut();
                    })
                    this.buildAnimation = false;
                }
                else {
                    this.buildAnimation = true;
                    $('#loading').fadeOut();
                }
            }
            catch( err ) {
                this.buildAnimation = true;
            }
        }
        else {
            this.performs.loadAvatar( item.src, 0 , new THREE.Quaternion(), item.id, () => {
                this.performs.changeAvatar( item.id );
    
                this.trajectoriesHelper.object = this.performs.currentCharacter.model;
                const mixer = this.performs.currentCharacter.mixer;
                mixer.setTime(this.video.currentTime);
                if( this.performs.keyframeApp.currentAnimation ) {
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
                    const track = animation.mixerBodyAnimation.tracks[0];
                    this.trajectoriesHelper.trajectoryEnd = track.times.length;
                    this.trajectoriesHelper.mixer = mixer;
                    this.trajectoriesHelper.computeTrajectories(animation);
                }
                if(this.mode == App.modes.CAMERA) {
                    if(item.id != "Eva" || item.id != "EvaLow") {
                        const srcSkeleton = this.visualizer.skeleton = applyTPose(this.visualizer.skeleton).skeleton;
                        const trgSkeleton = this.performs.currentCharacter.skeleton = applyTPose(this.performs.currentCharacter.skeleton).skeleton;
                        this.retargeting = new AnimationRetargeting(srcSkeleton, trgSkeleton, {srcPoseMode: AnimationRetargeting.BindPoseModes.DEFAULT, trgPoseMode: AnimationRetargeting.BindPoseModes.CURRENT});
                        //this.visualizer.loadAvatar( this.performs.currentCharacter )
                    }
                    else {
                        this.retargeting = null;
                    }
                }
            
            

            $('#loading').fadeOut(); //hide();
        }, (err) => {
            $('#loading').fadeOut();
            alert("There was an error loading the character", "Character not loaded");
        } );
    }
    }

    showTrajectoriesDialog() {

        if(this.trajectoriesDialog) {
            this.trajectoriesDialog.close();
            this.trajectoriesDialog = null;
            return;
        }
        this.trajectoriesDialog = new LX.Dialog("Trajectories", (p) => {
            p.clear();
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
   
    async loadVideo( signName, src ) {

        const landmarksDataUrl = 'https://catsl.eelvex.net/static/vid_data/teacher-' + signName + '/teacher-' + signName + '_keyframe_1.json';
        this.video.crossOrigin = "anonymous";
        this.video.src = src ? src : `https://vistasl.eelvex.net/static/vid/teacher-${encodeURIComponent(signName)}.mp4`;// `https://catsl.eelvex.net/static/vid/teacher-${signName}.mp4`; // "teacher-video-Ψ.mp4";
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
                        if(this.show2DLandmarksVideo) {
                            this.draw2DLandmarksVideo();
                        }
                        // const landmarks = landmarksData[0].landmarks;
                        // if(landmarks) {
                        //     // landmarks.map(landmark => {
                        //     //     return {
                        //     //         x: 1 - landmark.x,
                        //     //         y: landmark.y,
                        //     //         visibility: landmark.visibility
                        //     //     };
                        //     // });
                        //     this.drawingVideoUtils.drawConnectors( landmarks, HandLandmarker.HAND_CONNECTIONS, {color: '#1a2025', lineWidth: 4}); //'#00FF00'
                        //     this.drawingVideoUtils.drawLandmarks( landmarks, {color: this.referenceColor, fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'

                        // }
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
        const vision = await FilesetResolver.forVisionTasks( "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm" );
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: runningMode,
            numHands: 2
        });

        this.poseLandmarker = await PoseLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
                    delegate:"GPU"
                },
                runningMode: runningMode//"VIDEO"//runningMode,
            // minTrackingConfidence: 0.001,
            // minPosePresenceConfidence: 0.001,
            // minPoseDetectionConfidence: 0.001
        });
    }

    //   onBeginCapture() {
    //     const on_error = (err) => {
    //         console.log("capture error")
    //     }

    //     MediaPipe.start(true, (landmarks) => {
    //         // on results
    //         this.visualizer.buildPose(landmarks);
    //     },
    //     (detections) => {
    //         // on results
    //         this.visualizer.processDetections(detections);
    //     }
    //     );
    // }

        /**
     * @description Set the webcam stream to the video element and create the mediarecorder, enables mediapipe. Called from processWebcam() and on redo the capture.
    */
    async prepareWebcamRecording() {

        // this.createCaptureArea();
        // this.enable();
        $('#text')[0].innerText = "Preparing camera..."
        $('#loading').fadeIn();
        this.videoEditor.hideControls();
        if(this.performs.keyframeApp.mixer._actions.length)
        {
            this.performs.keyframeApp.mixer.stopAllAction();
            this.performs.keyframeApp.mixer.uncacheAction(this.performs.keyframeApp.mixer._actions[0]);
            this.performs.keyframeApp.mixer._actions = [];
        }
        const constraints = { video: true, audio: false, width: 1280, height: 720 };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const inputVideo = this.video; // this video will hold the camera stream
        const canvasVideo = this.videoCanvas; // this canvas will output image, landmarks (and edges)
        inputVideo.src = "";
        if( !inputVideo.srcObject ) {
            inputVideo.srcObject = stream;
        }

        return new Promise( (resolve, reject) => {
            inputVideo.onloadedmetadata = ( async (e) => {

                inputVideo.play();
                console.log(inputVideo.videoWidth)
                console.log(inputVideo.videoHeight);
                
                const aspect = inputVideo.videoWidth / inputVideo.videoHeight;
                
                const height = inputVideo.parentElement.clientHeight;
                const width = height * aspect;
                if( !this.mediapipe.loaded ) {
                    await this.mediapipe.init();
                    this.handLandmarker = this.mediapipe.handDetector;
                    this.poseLandmarker = this.mediapipe.poseDetector;
                }
                // await this.initMediapipe();
                if( !this.visualizer.scene ) {
                    await this.visualizer.init(this.performs.scene, this.performs.currentCharacter, PoseLandmarker.POSE_CONNECTIONS, HandLandmarker.HAND_CONNECTIONS);
                }
                
                this.mediapipeOnlineEnabler = true;
                
                this.video.classList.remove("hidden");
                // const videoAspect =  this.video.clientHeight / this.video.videoHeight;
                const offset = this.video.clientHeight/ this.video.videoHeight;
                this.videoCanvas.height = this.video.clientHeight;
                this.videoCanvas.width =  this.video.videoWidth*offset;
                this.videoCanvas.classList.remove("hidden");
                
                $('#loading').fadeOut();
                $('#text')[0].innerText = "Loading character...";
                
                // Hide info
                document.getElementById("select-video").classList.add("hidden");
                resolve(true);
            } );
        })
            
    }

    /**
     * 
     * @param {array of Mediapipe landmarks} inLandmarks each entry of the array is a frame containing an object with information about the mediapipe output { FLM, PLM, LLM, RLM, PWLM, LWLM, RWLM }
     * @returns {array of Mediapipe landmarks} same heriarchy as inLandmarks but smoothed
     */
    smoothMediapipeLandmarks( inLandmarks, lambda, p  ){
        let outLandmarks = JSON.parse(JSON.stringify(inLandmarks));

        let arrayToSmoothX = new Array( inLandmarks.length );
        let arrayToSmoothY = new Array( inLandmarks.length );
        let arrayToSmoothZ = new Array( inLandmarks.length );
 
        const initialValues = inLandmarks[0];
       
        for(let l = 0; l < initialValues.length; ++l ){
            
            //for each frame get the value to smooth (or a default one)
            let values = initialValues[l]; // default values in case there is no landmark estimation for a frame
            for( let f = 0; f < inLandmarks.length; ++f ){

                if (outLandmarks[f] ){
                    values = outLandmarks[f][l];  // found a valid landmark, set it as default
                }
                arrayToSmoothX[f] = values.x;
                arrayToSmoothY[f] = values.y;
                arrayToSmoothZ[f] = values.z;
            }

            const smoothX = whittakerAsymmetricSmoothing(arrayToSmoothX, lambda, p);
            const smoothY = whittakerAsymmetricSmoothing(arrayToSmoothY, lambda, p);
            const smoothZ = whittakerAsymmetricSmoothing(arrayToSmoothZ, lambda, p);

            //for each frame, set smoothed values
            for( let f = 0; f < inLandmarks.length; ++f ){
                if (outLandmarks[f]){
                    outLandmarks[f][l].x = smoothX[f];
                    outLandmarks[f][l].y = smoothY[f];
                    outLandmarks[f][l].z = smoothZ[f];

                    // if(f == inLandmarks.length-1) {
                    //     // light prediction (avoids delay)
                    //     const smooth = new THREE.Vector3(smoothX[f], smoothY[f], smoothZ[f]);
                    //     const last = new THREE.Vector3(inLandmarks[inLandmarks.length - 1][l].x, inLandmarks[inLandmarks.length - 1][l].y, inLandmarks[inLandmarks.length - 1][l].z);
                    //     const prev = new THREE.Vector3(inLandmarks[inLandmarks.length - 2][l].x, inLandmarks[inLandmarks.length - 2][l].y, inLandmarks[inLandmarks.length - 2][l].z);
                       
                    //     const velocity = last.clone().sub(prev);
                    //     const predicted = smooth.clone().add(velocity.multiplyScalar(0.5));
                    //     outLandmarks[f][l].x = predicted.x;
                    //     outLandmarks[f][l].y = predicted.y;
                    //     outLandmarks[f][l].z = predicted.z;
                    // }
                }

            } 
        } // end of landmark


        return outLandmarks;
    }

    draw2DLandmarksVideo() {
        const canvasCtx = this.videoCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.videoCanvas.width, this.videoCanvas.height);
        if( this.originalLandmarks && this.show2DLandmarksVideo ) {
            const offset = this.video.clientHeight/ this.video.videoHeight;
            this.videoCanvas.height = this.video.clientHeight;
            this.videoCanvas.width =  this.video.videoWidth*offset;
            const landmarks = this.originalLandmarks[0].landmarks;
            if(landmarks) {
            
                this.drawingVideoUtils.drawConnectors( landmarks, HandLandmarker.HAND_CONNECTIONS, {color: '#1a2025', lineWidth: 4}); //'#00FF00'
                this.drawingVideoUtils.drawLandmarks( landmarks, {color: this.referenceColor , fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'
            }
        }
    }

    draw2DLandmarksWebcam(handLandmarks, poseLandmarks) {
        const canvasCtx = this.videoCanvas.getContext('2d');
        canvasCtx.clearRect(0, 0, this.videoCanvas.width, this.videoCanvas.height);
        if( this.show2DLandmarksVideo ) {
            // const offset = this.video.clientHeight/ this.video.videoHeight;
            // this.videoCanvas.height = this.video.clientHeight;
            // this.videoCanvas.width =  this.video.videoWidth*offset;
            //const landmarks = this.originalLandmarks[0].landmarks;
            for(let i = 0; i < handLandmarks.length; i++) {
                if(handLandmarks[i].length) {
            
                    this.drawingVideoUtils.drawConnectors( handLandmarks[i], HandLandmarker.HAND_CONNECTIONS, {color: '#1a2025', lineWidth: 4}); //'#00FF00'
                    this.drawingVideoUtils.drawLandmarks( handLandmarks[i], {color: this.referenceColor , fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'
                }
            }
            
            for(let i = 0; i < poseLandmarks.length; i++) {
                if(poseLandmarks[i].length) {
            
                    this.drawingVideoUtils.drawConnectors( poseLandmarks[i], PoseLandmarker.POSE_CONNECTIONS, {color: '#1a2025', lineWidth: 4}); //'#00FF00'
                    this.drawingVideoUtils.drawLandmarks( poseLandmarks[i], {color: this.referenceColor , fillColor: this.referenceColor, lineWidth: 2}); //'#00FF00'
                }
            }
        }
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
        
        if(this.show2DLandmarksVideo) {
            this.draw2DLandmarksVideo();
        }
    }

    async animate( dt ) {

        if( this.mode == App.modes.VIDEO ) {
            this.mediapipeScene.leftHandPoints.visible = false;
            this.mediapipeScene.rightHandPoints.visible = false;

            const canvasCtx = this.characterCanvas.getContext('2d');
            canvasCtx.clearRect(0, 0, this.characterCanvas.width, this.characterCanvas.height);

            if( this.handLandmarker && ( this.show2DLandmarksAvatar || this.show3DLandmarks )) {

                // Convert 3D canvas ( three scene ) into image to send it to Mediapipe
                const bitmap = await createImageBitmap(this.performs.renderer.domElement);

                const detectionsHand = this.handLandmarker.detect(bitmap);
                bitmap.close();
                if (detectionsHand.landmarks.length) {
                    const originalLandmarks = this.originalLandmarks ? this.originalLandmarks[0].landmarks : null;
                    const originalData = this.originalLandmarks ? this.originalLandmarks[0].handedness : "";
                    let index = originalData.indexOf("index=") + 6;
                    index = Number(originalData[index]);
                    
                    if(  this.show2DLandmarksAvatar ) {
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

            // this.trajectoriesHelper.updateTrajectories( this.window.start, this.window.end );
        }
        else if( this.mediapipe && this.handLandmarker && this.poseLandmarker ) {
            // Convert 3D canvas ( three scene ) into image to send it to Mediapipe
            //const bitmap = await createImageBitmap(this.video);
            await this.mediapipe.processFrame(this.video);
            // console.log(this.mediapipe.currentResults)
            // const detectionsHands = this.handLandmarker.detect(bitmap);
            // const detectionsPose = this.poseLandmarker.detect(bitmap);
            //bitmap.close();
            let detections = {
                body:{l:[], w:[]},
                leftHand:{l:[], w:[]},
                rightHand:{l:[], w:[]},
                retargetLandmarks: false,
            }
            // this.draw2DLandmarksWebcam(detectionsHands.landmarks, detectionsPose.landmarks);
            this.draw2DLandmarksWebcam(this.handLandmarker.landmarks, this.poseLandmarker.landmarks);
            const results = this.mediapipe.currentResults;
            detections.body.l = results.landmarksResults.PLM || [];
            detections.body.w = results.landmarksResults.PWLM || [];
            detections.leftHand.l = results.landmarksResults.LLM || [];
            detections.leftHand.w = results.landmarksResults.LWLM || [];
            detections.rightHand.l = results.landmarksResults.RLM || [];
            detections.rightHand.w = results.landmarksResults.RWLM || [];
            // if( detectionsPose.worldLandmarks.length && detectionsPose.worldLandmarks[0]) {
                
            //     detections.body.l = detectionsPose.landmarks[0];
            //     detections.body.w =detectionsPose.worldLandmarks[0];
            // }
            
            // if( detectionsHands.worldLandmarks.length ) {
            //     for( let i = 0; i < detectionsHands.handednesses.length; ++i ){
            //         let h = detectionsHands.handednesses[i][0];                    
            //         if( h.categoryName == 'Left' ){                        
            //             detections.leftHand.l = detectionsHands.landmarks[i];
            //             detections.leftHand.w = detectionsHands.worldLandmarks[i];
            //         }
            //         else{
            //             detections.rightHand.l = detectionsHands.landmarks[i];
            //             detections.rightHand.w = detectionsHands.worldLandmarks[i];
            //         }
            //     }
            // }
            if( this.smoothLandmarks ) {
                detections = this.visualizer.smoothDetections(detections, this.smoothFrameCount);
            }
            this.visualizer.processDetections(detections, PoseLandmarker.POSE_CONNECTIONS, HandLandmarker.HAND_CONNECTIONS);
            this.visualizer.animate();
        }
        else {
        }
        

        stats.update()

        requestAnimationFrame(this.animate.bind(this));
    }
}
App.modes = {VIDEO:0, CAMERA:1};

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


/**
 * Asymmetric Whittaker Smoothing
 * @param {Array<number>} y - Original data series
 * @param {number} lambda - Smoothness (100 - 1e7 usual range)
 * @param {number} p - Asymmetry parameter (0-1), typical 0.001 - 0.1
 * @returns {Array<number>} Smoothed data
 */
function whittakerAsymmetricSmoothing(values, lambda = 1000, p = 0.001) {
        const m = values.length;
        const w = new Array(m).fill(1);
        const z = [...values];

        for (let iter = 0; iter < 6; iter++) { // less iterations for real-time
            const W = z.map((_, i) => w[i] * values[i]);
            const A = Array.from({ length: m }, () => new Array(m).fill(0));

            // diagonales
            for (let i = 0; i < m; i++) A[i][i] = w[i] + lambda * 6;

            // second-derivative penalization
            for (let i = 0; i < m - 1; i++) {
                A[i][i + 1] -= lambda * 4;
                A[i + 1][i] -= lambda * 4;
            }
            for (let i = 0; i < m - 2; i++) {
                A[i][i + 2] += lambda;
                A[i + 2][i] += lambda;
            }

            // resolve Ax = W (remove fast gaussian)
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

            // asymmetry
            for (let i = 0; i < m; i++) {
                w[i] = (values[i] > z[i]) ? p : (1 - p);
            }
        }

        return z;
}
