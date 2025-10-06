import * as THREE  from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ScriptApp, findIndexOfBoneByName } from './ScriptApp.js';
import { KeyframeApp, computeAutoBoneMap } from './KeyframeApp.js';

let zip = typeof JSZip != 'undefined' ? new JSZip() : null;

class AnimationRecorder {
    constructor(numCameras, app) {
        this.isRecording = false;
        this.timeLimit = null;
        this.mediaRecorders = [];
        this.recordedChunks = [];
        this.renderers = [];
        this.clock = new THREE.Clock();
        this.handleDataAvailable = this.handleDataAvailable.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.animationsCount = 0;
        this.enabledCameras = 0;
        this.exportZip = true;

        for (let i = 0; i < numCameras; i++) {
            // offscreen renderer for each camera
            const offscreenRenderer = new THREE.WebGLRenderer( {antialias: true, preserveDrawingBuffer :true} );
            offscreenRenderer.setSize(window.innerWidth, window.innerHeight);
            offscreenRenderer.setPixelRatio(window.devicePixelRatio);
            offscreenRenderer.toneMapping = THREE.LinearToneMapping;
            offscreenRenderer.toneMappingExposure = 1;
            this.renderers.push(offscreenRenderer);

            const stream = this.renderers[i].domElement.captureStream(60);
            const options = { mimeType: 'video/webm;', videoBitsPerSecond: 5 * 1024 * 1024 }; // 5 Mbps

            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorder.ondataavailable = (event) => this.handleDataAvailable(event, i);
            mediaRecorder.onstop = () => this.handleStop(i);
            mediaRecorder.onstart = () => this.handleStart(i);

            this.mediaRecorders.push( mediaRecorder );
            this.recordedChunks.push([]);
        };
        this.app = app;
    }

    async manageMultipleCapture (keyframeApp) {
        this.keyframeApp = keyframeApp;
        let animations = [];
        
        for (let animationName in keyframeApp.loadedAnimations) {
            let animation = keyframeApp.loadedAnimations[animationName];
            if (!animation.record) {
                continue;
            }
            animations.push(animationName);
        }
        this.animationsCount = animations.length;

        for (let i = 0; i < animations.length; i++) {
            const animationName = animations[i];
            let animation = keyframeApp.loadedAnimations[animationName];
            if(this.onStartCapture) {
                this.onStartCapture('(' + (i+1) + '/' + animations.length+ ') ' + animationName);
            }
            await this.manageCapture(animationName, animation.bodyAnimation.duration);
        }
    }

    manageCapture (animationName, timeLimit = null) {
        if (this.app.mode == Performs.Modes.SCRIPT){
            this.animationsCount = 1;
            if(this.onStartCapture) {
                this.onStartCapture('');
            }
            if (this.isRecording) { 
                this.stopCapture(); 
                // if(this.onStopCapture) {
                //     this.onStopCapture();
                // }
            }
            else { this.startCapture("BML"); }
        }
        else if (this.app.mode == Performs.Modes.KEYFRAME) {
        
            return new Promise((resolve) => {
                this.onCaptureComplete = resolve;
                this.keyframeApp.onChangeAnimation(animationName);
                this.startCapture(animationName);
                
                // automatically stop recording after animation stops
                this.timeLimit = timeLimit; // in seconds
            });
        }
    }

    startCapture (animationName) {
        this.isRecording = true;
        this.enabledCameras = 0;
        for( let i = 0; i < this.app.cameras.length; i++) {
            if(!this.app.cameras[i].record) {
                continue;
            }
            this.enabledCameras += 1;
            this.recordedChunks[i] = [];
            this.mediaRecorders[i].start();
        }
        // this.recordedChunks.forEach((chunk, i, arr) => arr[i] = []); // reset chuncks
        // this.mediaRecorders.forEach(recorder => { recorder.start() });
        this.currentAnimationName = animationName; // Store the animation name
    }
        
    stopCapture () {
        this.isRecording = false;
        this.mediaRecorders.forEach(recorder => recorder.stop());   
    }

    handleDataAvailable (event, idx) {
        if (event.data.size > 0) {
            this.recordedChunks[idx].push(event.data);
        }
    }

    handleStart (idx) {
        if (idx === 0) {
            if (this.app.mode == Performs.Modes.SCRIPT){
                this.app.scriptApp.replay();
            }
            else if (this.app.mode == Performs.Modes.KEYFRAME) {
                this.app.keyframeApp.changePlayState(true); // start animation                
            }
        }
        this.clock.start();
    }

    handleStop (idx) {
        const animationName = this.currentAnimationName;
        const blob = new Blob(this.recordedChunks[idx], {type: 'video/webm'});
        const name =  `${animationName} ${idx + 1}.webm`;

        blobToBase64(blob, (binaryData) => {
            if(!zip && this.exportZip) {
                console.error("JSZip not imported. The recordings can't be downloaded.");
            }

            if(zip && this.exportZip) {
                // Add downloaded file video to zip in the specified folder:
                zip.folder(animationName).file(name, binaryData, {base64: true})
                let files = Object.keys(zip.files);
    
                if((files.length - this.animationsCount) == this.animationsCount * this.enabledCameras) {
                    if(this.onStopCapture) {
                        this.onStopCapture();
                    }
                    // All files have been downloaded, create the zip and download it
                    zip.generateAsync({type:"base64"}).then(function (base64) {
                        let zipName = 'performs-recordings.zip';
                        let a = document.createElement('a'); 
                        // Then trigger the download link
                        a.href = "data:application/zip;base64," + base64;
                        a.download = zipName;
                        a.click();
                        zip.files = {};
                    });
                }
            }
            else {
                let a = document.createElement('a'); 
                // Then trigger the download link
                a.href = "data:application/webm;base64," + binaryData;
                a.download = name;
                a.click();

                if(this.isRecording == false) {
                    if(this.onStopCapture) {
                        this.onStopCapture();
                    }
                }
            }
        });

        // refresh gui
        if (idx === 0) {
            if (this.app.mode == Performs.Modes.SCRIPT) {
                // reset avatar pose / stop animation
                this.app.scriptApp.ECAcontroller.reset(true);
            }
        }

        // reset clock to 0
        this.clock.elapsedTime = 0;
        this.clock.stop();

        // Check if all recorders have stopped
        if (this.mediaRecorders.every(recorder => recorder.state === 'inactive')) {
            if (this.onCaptureComplete) {
                this.onCaptureComplete(); // Resolve the promise to indicate that capture is complete
                this.onCaptureComplete = null; // Clear the reference
            }
        }
    }

    update (scene, cameras) {
        // render for all cameras
        for (let i = 0; i < this.renderers.length; i++) {
            this.renderers[i].render( scene, cameras[i] );
        }

        if (this.timeLimit && this.clock.getElapsedTime() > this.timeLimit ) {
            this.app.keyframeApp.changePlayState(false);  // stop animation
            this.stopCapture();
        }
    }
}


function blobToBase64(blob, callback) {
    var reader = new FileReader();
    reader.onload = function() {
        var dataUrl = reader.result;
        var base64 = dataUrl.split(',')[1];
        callback(base64);
    };
    reader.readAsDataURL(blob);
}


// Correct negative blenshapes shader of ThreeJS
THREE.ShaderChunk[ 'morphnormal_vertex' ] = "#ifdef USE_MORPHNORMALS\n	objectNormal *= morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n	    objectNormal += getMorph( gl_VertexID, i, 1, 2 ) * morphTargetInfluences[ i ];\n		}\n	#else\n		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];\n		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];\n		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];\n		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];\n	#endif\n#endif";
THREE.ShaderChunk[ 'morphtarget_pars_vertex' ] = "#ifdef USE_MORPHTARGETS\n	uniform float morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];\n		uniform sampler2DArray morphTargetsTexture;\n		uniform vec2 morphTargetsTextureSize;\n		vec3 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset, const in int stride ) {\n			float texelIndex = float( vertexIndex * stride + offset );\n			float y = floor( texelIndex / morphTargetsTextureSize.x );\n			float x = texelIndex - y * morphTargetsTextureSize.x;\n			vec3 morphUV = vec3( ( x + 0.5 ) / morphTargetsTextureSize.x, y / morphTargetsTextureSize.y, morphTargetIndex );\n			return texture( morphTargetsTexture, morphUV ).xyz;\n		}\n	#else\n		#ifndef USE_MORPHNORMALS\n			uniform float morphTargetInfluences[ 8 ];\n		#else\n			uniform float morphTargetInfluences[ 4 ];\n		#endif\n	#endif\n#endif";
THREE.ShaderChunk[ 'morphtarget_vertex' ] = "#ifdef USE_MORPHTARGETS\n	transformed *= morphTargetBaseInfluence;\n	#ifdef MORPHTARGETS_TEXTURE\n		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n			#ifndef USE_MORPHNORMALS\n				transformed += getMorph( gl_VertexID, i, 0, 1 ) * morphTargetInfluences[ i ];\n			#else\n				transformed += getMorph( gl_VertexID, i, 0, 2 ) * morphTargetInfluences[ i ];\n			#endif\n		}\n	#else\n		transformed += morphTarget0 * morphTargetInfluences[ 0 ];\n		transformed += morphTarget1 * morphTargetInfluences[ 1 ];\n		transformed += morphTarget2 * morphTargetInfluences[ 2 ];\n		transformed += morphTarget3 * morphTargetInfluences[ 3 ];\n		#ifndef USE_MORPHNORMALS\n			transformed += morphTarget4 * morphTargetInfluences[ 4 ];\n			transformed += morphTarget5 * morphTargetInfluences[ 5 ];\n			transformed += morphTarget6 * morphTargetInfluences[ 6 ];\n			transformed += morphTarget7 * morphTargetInfluences[ 7 ];\n		#endif\n	#endif\n#endif";

class Performs {
    static Modes = { SCRIPT: 0, KEYFRAME: 1 };
    static Backgrounds = { OPEN:0, STUDIO: 1, PHOTOCALL: 2};
    static ATELIER_URL = "https://atelier.gti.upf.edu/";
    static ANIMICS_URL = "https://animics.gti.upf.edu/";
    static AVATARS_URL = "https://resources.gti.upf.edu/3Dcharacters/";

    constructor() {
        
        this.elapsedTime = 0; // clock is ok but might need more time control to dinamicaly change signing speed
        this.clock = new THREE.Clock();
        this.loaderGLB = new GLTFLoader();
        this.GLTFExporter = new GLTFExporter;

        this.scene = null;
        this.renderer = null;
        this.camera = null;
        this.cameras = [];
        this.controls = [];
        this.cameraMode = 0;

        this.loadedCharacters = {};
        this.currentCharacter = null;

        this.speed = 1;
        this.backPlane = null;
        this.avatarShirt = null;
        this.autoplay = false;

        this.mode = Performs.Modes.SCRIPT;
        this.scriptApp = new ScriptApp();        
        this.keyframeApp = new KeyframeApp();   
        
        this.isAppReady = false;
        this.pendingMessageReceived = null;
        this.showControls = true;

        this.sceneColor = 0x46c219;
        this.background = Performs.Backgrounds.OPEN;

        this.logo = "./data/imgs/performs2.png";
        this.videoBackground = null;
        this.backgroundSettings = "Expand";
        this.textureScale = 1;
        this.texturePosition = [0, 0];

        this._atelier = null;

        this.raycaster = new THREE.Raycaster();
    }

    setSpeed( value ){ this.speed = value; }
    // value (hex colour) in sRGB space 
    setBackPlaneColour( value ){
        this.sceneColor = value;
        this.scene.background.set(value);

        if ( this.backPlane ){ 
            if(this.backPlane.material.color) {
                this.backPlane.material.color.set( value );   
            }
            else {
                this.photocallMaterial.uniforms.color.value.set(value);
                this.backPlane.material.uniforms.color.value.set(value);
                this.backPlane.material.needsUpdate = true;
            }
        }                

        if(this.ground) {
            this.ground.material.color.set( value ); 
        }
        return true;
    }
    
    setBackground( type, image = null ) {
        this.background = type;

        switch(type) {
            case Performs.Backgrounds.OPEN:
                this.backPlane.visible = false;
                this.ground.visible = true;
                break;
            case Performs.Backgrounds.STUDIO:
                this.backPlane.visible = true;
                this.ground.visible = false;
                this.repeatBackground = false;
                // let texture = null;
                if(image) {
                    if( image instanceof String) {
                        this.backgroundTexture = new THREE.TextureLoader().load( this.backgroundTexture);
                    }
                    else if( !(image instanceof THREE.Texture || image instanceof THREE.VideoTexture) ) {
                        this.backgroundTexture = new THREE.Texture( this.backgroundTexture );
                        this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
                    }                           
                    this.backgroundTexture.needsUpdate = true;

                    const shader = this.backPlane.material.userData.shader;
                    if ( shader ) {
                        shader.uniforms.textureMap.value = this.backgroundTexture;
                    }
                    else {
                        this.studioMaterial.uniforms.textureMap.value = this.backgroundTexture;
                    }
                }
                this.backPlane.material = this.studioMaterial;

                if(this.backPlane.material.color) {
                    this.backPlane.material.color.set(this.sceneColor);
                }
                else {
                    this.backPlane.material.uniforms.color.value.set(this.sceneColor);
                }

                this.backPlane.material.needsUpdate = true;
               
                break;
            case Performs.Backgrounds.PHOTOCALL:
                this.backPlane.visible = true;
                this.ground.visible = false;
                this.repeatBackground = true;
                // let texture = null;
                if(image) {
                    if(typeof(image) == 'string') {
                        this.logoTexture = new THREE.TextureLoader().load( this.logo);
                    }
                    else {
                        this.logoTexture = new THREE.Texture( this.logo );
                        this.logoTexture.colorSpace = THREE.SRGBColorSpace;
                    }                           
                    this.logoTexture.needsUpdate = true;

                    const shader = this.backPlane.material.userData.shader;
                    if ( shader ) {
                        shader.uniforms.textureMap.value = this.logoTexture;
                    }
                    else {
                        this.photocallMaterial.uniforms.textureMap.value = this.logoTexture;
                    }
                }
                this.backPlane.material = this.photocallMaterial;

                if(this.backPlane.material.color) {
                    this.backPlane.material.color.set(this.sceneColor);
                }
                else {
                    this.backPlane.material.uniforms.color.value.set(this.sceneColor);
                }

                this.backPlane.material.needsUpdate = true;
                break;
        }
    }
        
    setPhotocallOffset(offset) {
        if(!this.backPlane.material.uniforms) {
            const shader = this.backPlane.material.userData.shader;
            if ( shader ) {
                shader.uniforms.offset.value = offset;
            }
        }
        else {
            this.backPlane.material.uniforms.offset.value = offset;
        }
        this.backPlane.material.needsUpdate = true;
        this.repeatOffset = offset;
    }

    setBackgroundSettings( settings ) {
        if(!this.backPlane.material.uniforms) {
            const shader = this.backPlane.material.userData.shader;
            if ( shader ) {
                shader.defines.EXPAND = settings == "Expand";
                shader.defines.FILL = settings == "Fill";
                shader.defines.EXTEND = settings == "Extend";
                shader.defines.ADJUST = settings == "Adjust";
            }
        }
        else {
            this.backPlane.material.defines.EXPAND = settings == "Expand";
            this.backPlane.material.defines.FILL = settings == "Fill";
            this.backPlane.material.defines.EXTEND = settings == "Extend";
            this.backPlane.material.defines.ADJUST = settings == "Adjust";
        }
        this.backPlane.material.needsUpdate = true;
        this.backgroundSettings = settings;
    }
   
    setBackgroundTextureScale ( scale ) {
        if(!this.backPlane.material.uniforms) {
            const shader = this.backPlane.material.userData.shader;
            if ( shader ) {
                shader.uniforms.scale.value = scale;
            }
        }
        else {
            this.backPlane.material.uniforms.scale.value = scale;
        }
        this.backPlane.material.needsUpdate = true;
        this.textureScale = scale;
    }

    setBackgroundTexturePosition ( position ) {
        if(!this.backPlane.material.uniforms) {
            const shader = this.backPlane.material.userData.shader;
            if ( shader ) {
                shader.uniforms.position.value = position;
            }
        }
        else {
            this.backPlane.material.uniforms.position.value = position;
        }
        this.backPlane.material.needsUpdate = true;
        this.texturePosition = position;
    }

    // value (hex colour) in sRGB space 
    setClothesColour( value ){
        if ( !this.avatarShirt ){ return false; }
        this.avatarShirt.material.color.set( value );   
        return true;
    }

    
    // Change the default settings for the scene and the applications mode options
    async setConfiguration(settings, callback) {

        let rotation = null;
        if(settings.rotation) {
            rotation = settings.rotation;
            rotation = rotation.split(',');    
            rotation = rotation.map(v => v = Number(v));        
        }

        let position = null;
        if(settings.position) {
            position = settings.position;
            position = position.split(',');
            position = position.map(v => v = Number(v));
            // this.currentCharacter.model.position.fromArray(position);
        }

        let scale = null;
        if(settings.scale) {
            scale = settings.scale;
            scale = Number(scale);
            scale = [scale, scale, scale];
            // this.currentCharacter.model.scale.fromArray([scale, scale, scale]);
        }

        const innerAvatarSettings = (settings) => {
            if(settings.cloth) {
                let clothColor = settings.cloth;
                if(typeof(clothColor) == 'string'){
                    clothColor = clothColor.replace('0x', '#');
                }
                this.setClothesColour(clothColor);
            }
            if(rotation) {
                this.currentCharacter.rotation = new THREE.Quaternion().fromArray(rotation);
            }
            if(position) {
                this.currentCharacter.position = new THREE.Vector3().fromArray(position);
            }
            if(scale) {
                this.currentCharacter.scale = new THREE.Vector3().fromArray(scale);
            }

            if(settings.animations) {
                if(typeof(settings.animations) == 'string') {
                    settings.animations = JSON.parse(settings.animations);
                }
                this.keyframeApp.processMessageFiles( settings.animations).then(
                    (animations) => {
                        this.keyframeApp.currentAnimation = animations[0];
                        this.changeMode(Performs.Modes.KEYFRAME);
                        if(this.autoplay) {
                            this.keyframeApp.changePlayState(true);
                        }

                        if(rotation) {
                            this.currentCharacter.model.quaternion.fromArray(rotation);
                        }

                        if(position) {                           
                            this.currentCharacter.model.position.fromArray(position);
                        }

                        if(scale) {

                            this.currentCharacter.model.scale.fromArray(scale);
                        }

                        if(settings.onReady) {
                            settings.onReady();
                        }
                        if(callback) {
                            callback();
                        }
                    }
                )
            }
            else if(settings.scripts) {
                this.scriptApp.processMessageFiles(settings.scripts).then(
                    (results) => {
                        this.scriptApp.onMessage(results);
                        this.changeMode(Performs.Modes.SCRIPT);
                        if(this.autoplay) {
                            this.scriptApp.replay();
                            if(this.videoBackground) {
                                this.videoBackground.play();
                            }
                        }

                        if(rotation) {
                            this.currentCharacter.model.quaternion.fromArray(rotation);
                        }

                        if(position) {                           
                            this.currentCharacter.model.position.fromArray(position);
                        }

                        if(scale) {

                            this.currentCharacter.model.scale.fromArray(scale);
                        }
                        
                        if(settings.onReady) {
                            settings.onReady();
                        }
                        if(callback) {
                            callback();
                        }
                    }
                );
            }
            else {
                if(rotation) {
                    this.currentCharacter.model.quaternion.fromArray(rotation);
                }

                if(position) {                           
                    this.currentCharacter.model.position.fromArray(position);
                }

                if(scale) {

                    this.currentCharacter.model.scale.fromArray(scale);
                }
    
                if(settings.onReady) {
                    settings.onReady();
                }
                if(callback) {
                    callback();
                }
            }
        }

       
        if(settings.autoplay != undefined) {
            this.autoplay = settings.autoplay;
        }
        
        if(settings.crossfade != undefined) {
            this.keyframeApp.useCrossFade = settings.crossfade;
        }

        if(settings.srcEmbeddedTransforms != undefined) {
            this.keyframeApp.srcEmbedWorldTransforms = settings.srcEmbeddedTransforms;
        }
        if(settings.trgEmbeddedTransforms != undefined) {
            this.keyframeApp.trgEmbedWorldTransforms = settings.trgEmbeddedTransforms;
        }

        if(settings.srcReferencePose != undefined) {
            this.keyframeApp.srcPoseMode = settings.srcReferencePose;
        }
        if(settings.trgReferencePose != undefined) {
            this.keyframeApp.trgPoseMode = settings.trgReferencePose;
        }

        let loadConfig = true;
        if(settings.avatar) {
            let avatar = settings.avatar;
            const path = avatar.split(".");
            let filename = path[path.length-2];
            filename = filename.split("/");
            filename = filename.pop();
            
            if(!this.currentCharacter || this.currentCharacter && this.currentCharacter.model.name != filename) {
                loadConfig = false;
                $('#loading').fadeIn(); 
                let thumbnail = null;
                if( avatar.includes('models.readyplayer.me') ) {
                    avatar+= '?pose=T&morphTargets=ARKit&lod=1';
                    thumbnail =  "https://models.readyplayer.me/" + filename + ".png?background=68,68,68";
                }
                if(this.gui) {
                    this.gui.avatarOptions[filename] = [avatar, settings.config, new THREE.Quaternion(), thumbnail];
                }
                this.loadAvatar(avatar, settings.config, new THREE.Quaternion(), filename, () => {
                    this.changeAvatar( filename );
                    innerAvatarSettings(settings);
    
                    $('#loading').fadeOut(); //hide();               
                }, (err) => {
                    $('#loading').fadeOut();
                    alert("There was an error loading the avatar", "Avatar not loaded");
                } );
            }
            
        }
        if(loadConfig) {
            innerAvatarSettings(settings);
            if(settings.config) {
                let name = this.currentCharacter.model.name;
                try {
                    const response = await fetch(settings.config);
                    if (!response.ok) {
                        throw new Error(`Response status: ${response.status}`);
                    }
                    let config = await response.json();                        
                    config._filename = settings.config; 

                    this.currentCharacter.config = config;
                    this.scriptApp.onLoadAvatar(this.currentCharacter.model, this.currentCharacter.config, this.currentCharacter.skeleton);
                    this.currentCharacter.skeleton.pose();
                    this.scriptApp.ECAcontroller.reset();                        
                    this.changeMode(Performs.Modes.SCRIPT);
                    if(this.gui) {
                        this.gui.avatarOptions[name][1] = config._filename;
                        if(this.gui.settingsActive) {
                            this.gui.createSettingsPanel();             
                        }
                    }
                }
                catch (error) {
                    console.error(error.message, "File error!");
                }
            }
            if(rotation) {
                this.currentCharacter.model.quaternion.fromArray(rotation);
            }
        }

        if(settings.controls != undefined) {
            this.showControls = !(settings.controls === "false" || settings.controls === false);
        }

        // Default background
        if(settings.background) {
            let background = settings.background;
            switch(background.toLocaleLowerCase()) {
                case 'studio':
                    this.background = Performs.Backgrounds.STUDIO;
                    break;
                case 'photocall':
                        this.background = Performs.Backgrounds.PHOTOCALL;
                        break;
                default:
                    break;
            }
            this.setBackground(this.background);            
        }

        if(settings.img) {
            this.setBackground( Performs.Backgrounds.PHOTOCALL);         

            let image =settings.img;
            const imgCallback = ( event ) => {

                this.logo = event.target;        
                this.setBackground( Performs.Backgrounds.PHOTOCALL, this.logo);         
            }

            const img = new Image();            
            img.onload = imgCallback;    
            fetch(image)
            .then(function (response) {
                if (response.ok) {
                response.blob().then(function (miBlob) {
                    var objectURL = URL.createObjectURL(miBlob);
                    img.src = objectURL;
                });
                } else {
                console.log("Bad request");
                }
            })
            .catch(function (error) {
                console.log("Error:" + error.message);
            });        

        }

        // Default background color
        if(settings.color) {
            if(typeof(settings.color) == 'string'){
                settings.color = settings.color.replace('0x', '#');
                if(!settings.color.includes("#")) {
                    settings.color = "#" + settings.color;
                }
            }
            this.sceneColor = settings.color;
            this.setBackPlaneColour(this.sceneColor);                                  
        }

        if(settings.offset) {
            let offset = Number(settings.offset);
            this.setPhotocallOffset(offset);
        }

        // Default light color
        if(settings.light) {
            let light = settings.light;
            if(typeof(light) == 'string'){
                light = light.replace('0x', '#');
            }
            this.dirLight.color.set(light);                          
        }

        // Default light position
        if(settings.lightpos) {
            let light = settings.lightpos;
            light = light.split(',');
            if(light.length == 3) {
                this.dirLight.position.set(Number(light[0]), Number(light[1]), Number(light[2]));                  
            }           
        }
        
        if(settings.restrictView != undefined) {
            let view = (settings.restrictView === "false" || settings.restrictView === false);
            this.changeCameraMode( view ); //moved here because it needs the backplane to exist
        }

        if(settings.applyIdle != undefined) {
            this.scriptApp.applyIdle = settings.applyIdle;
        }
    }

    // Change app mode: Keyframe or Script
    changeMode( mode ) {
        this.mode = mode;
        if(this.currentCharacter) {
            this.currentCharacter.skeleton.pose();
        }
        if(this.scriptApp.ECAcontroller) {
            this.scriptApp.ECAcontroller.reset();
            this.scriptApp.ECAcontroller.update(0,0);
        }

        if(this.mode == Performs.Modes.KEYFRAME && this.keyframeApp.currentAnimation) {
            this.keyframeApp.onChangeAnimation(this.keyframeApp.currentAnimation, true);
            if(this.autoplay) {
                this.keyframeApp.changePlayState(true);
            }
        }
        if(this.gui) {
            this.gui.onChangeMode(mode);
        }
    }

    getSpeed( ){ return this.speed; }

    // returns value (hex) with the colour in sRGB space
    getBackPlaneColour(){       
        return this.sceneColor; // css works in sRGB
    }

    // returns value (hex) with the colour in sRGB space
    getClothesColour(){
        if ( !this.avatarShirt ){ return 0; }   
        return this.avatarShirt.material.color.getHexString(); // css works in sRGB
    }

    init(options) {        
        this.scene = new THREE.Scene();
        const sceneColor = this.sceneColor = window.debugMode ? 0x4f4f9c : 0x46c219;
        this.scene.background = new THREE.Color( sceneColor );

        // renderer
        this.renderer = new THREE.WebGLRenderer( { antialias: true } );
        this.renderer.setPixelRatio( window.devicePixelRatio );
        this.renderer.setSize( window.innerWidth, window.innerHeight );

        this.renderer.toneMapping = THREE.LinearToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // this.renderer.shadowMap.type = THREE.VSMShadowMap; // Produces artifacts, camera has to be close to objects and negative bias
        
        // camera views
        this.createCameras();
   
        // lights
        this.createLights();

        // background
        this.createBackgrounds();

        // animation recorder
        this.createRecorder();

        // so the screen is not black while loading
        this.changeCameraMode( false ); //moved here because it needs the backplane to exist
        this.renderer.render( this.scene, this.cameras[this.camera] );        
        this.scriptApp.init(this.scene);
    
        if(!options)  {
            options = {};
            // Get URL params to configurate the scene
            const queryString = window.location.search;
            const urlParams = new URLSearchParams(queryString);       
            for (const [key, value] of urlParams.entries()) {
                options[key] = value;
            }
        }

        let modelToLoad = [Performs.AVATARS_URL+'Eva_Low/Eva_Low.glb', Performs.AVATARS_URL+'Eva_Low/Eva_Low.json', (new THREE.Quaternion()).setFromAxisAngle( new THREE.Vector3(1,0,0), 0 ), "EvaLow" ];
        
        // Default avatar & config file
        if(options.avatar) {
            let avatar = options.avatar;
            const path = avatar.split(".");
            let filename = path[path.length-2];
            filename = filename.split("/");
            filename = filename.pop();
            
            avatar += avatar.includes('models.readyplayer.me') ? '?pose=T&morphTargets=ARKit&lod=1' : '';

            modelToLoad = [ avatar, options.config, new THREE.Quaternion(), filename];          
        }

        if(options.rotation) {
            let rotation = options.rotation;
            rotation = rotation.split(',');
            modelToLoad[2].fromArray(rotation);
        }
        
        // Load default avatar
        this.loadAvatar(modelToLoad[0], modelToLoad[1], modelToLoad[2], modelToLoad[3], () => {
            this.changeAvatar( modelToLoad[3] );
          
            this.setConfiguration(options);
            // Create the GUI only if the class exists or the showControls flag is true
            if ( typeof GUI != "undefined" && this.showControls) { 
                this.gui = new GUI( this ); 
                if(!this.gui.avatarOptions[modelToLoad[3]]) {
                    const name = modelToLoad[3];
                    modelToLoad[3] = modelToLoad[0].includes('models.readyplayer.me') ? ("https://models.readyplayer.me/" + name + ".png?background=68,68,68") : GUI.THUMBNAIL;
                    this.gui.avatarOptions[name] = modelToLoad;
                    this.gui.refresh();
                }
            }
            else {
                window.document.body.appendChild(this.renderer.domElement);
            }

            $('#loading').fadeOut(); //hide();
            this.animate();
            this.isAppReady = true;
                        
            if(this.pendingMessageReceived) {
                this.onMessage( this.pendingMessageReceived );
                this.pendingMessageReceived = null; // although onMessage is async, the variable this.pendingMessageReceived is not used. So it is safe to delete
            }
        }, (err) => {
            $('#loading').fadeOut();
            alert("There was an error loading the avatar", "Avatar not loaded");
        } );

        // Create event listeners
        window.addEventListener( "message", this.onMessage.bind(this) );
        window.addEventListener( 'resize', this.onWindowResize.bind(this) );
    }
    
    newCameraFrom({azimuthAngle = 0, polarAngle = 0, depth = 0, controlsEnabled = false}) {
        let camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.01, 1000);
        camera.record = true;
        let controls = new OrbitControls( camera, this.renderer.domElement );

        controls.target.set(0, 1.3, 0);
        let newPos = new THREE.Vector3( 0, 1.5, Math.cos(5*Math.PI/180) );
        let distance = newPos.distanceTo(controls.target);

        let dir = new THREE.Vector3().subVectors(newPos, controls.target).normalize();
        dir.applyAxisAngle(new THREE.Vector3(1,0,0), polarAngle * Math.PI / 180);
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), azimuthAngle * Math.PI / 180);
        newPos.addVectors(controls.target, dir.multiplyScalar(distance));
        newPos.add(new THREE.Vector3(0,0,depth));

        controls.object.position.set(...newPos);

        controls.enableDamping = true; // this requires controls.update() during application update
        controls.dampingFactor = 0.1;
        controls.enabled = controlsEnabled;
        controls.update();

        this.cameras.push(camera); 
        this.controls.push(controls);
        
        return {camera: camera, controls: controls};
    }

    createCameras() {
        this.newCameraFrom({azimuthAngle: 0, controlsEnabled: true}); // init main Camera (0)
        this.newCameraFrom({azimuthAngle: 25});
        this.newCameraFrom({azimuthAngle: -25});
    
        this.camera = 0;
    }

    createLights() {
        const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.5 );
        this.scene.add( hemiLight );

        const keySpotlight = new THREE.SpotLight( 0xffffff, 3.5, 0, 45 * (Math.PI/180), 0.5, 2 );
        keySpotlight.position.set( 0.5, 2, 2 );
        keySpotlight.target.position.set( 0, 1, 0 );
        this.scene.add( keySpotlight.target );
        this.scene.add( keySpotlight );

        const fillSpotlight = new THREE.SpotLight( 0xffffff, 2.0, 0, 45 * (Math.PI/180), 0.5, 2 );
        fillSpotlight.position.set( -0.5, 2, 1.5 );
        fillSpotlight.target.position.set( 0, 1, 0 );
        // fillSpotlight.castShadow = true;
        this.scene.add( fillSpotlight.target );
        this.scene.add( fillSpotlight );

        const dirLight = this.dirLight = new THREE.DirectionalLight( 0xffffff, 2 );
        dirLight.position.set( 1.5, 5, 2 );
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.left= -2;
        dirLight.shadow.camera.right= 2;
        dirLight.shadow.camera.bottom= -2;
        dirLight.shadow.camera.top= 2;
        dirLight.shadow.camera.near= 0.5;
        dirLight.shadow.camera.far= 20;
        dirLight.shadow.bias = 0.00001;
        this.scene.add( dirLight );
        
        const dirLightTarget = new THREE.Object3D();
        this.scene.add( dirLightTarget );
        dirLight.target = dirLightTarget;
    }

    createBackgrounds() {
        // Create transparent ground for Open space
        const ground = this.ground = new THREE.Mesh( new THREE.PlaneGeometry(20,20), new THREE.MeshStandardMaterial( { color: this.sceneColor, opacity: 0.1, transparent:true, depthWrite: true, roughness: 1, metalness: 0 } ) );
        ground.name = 'Ground'
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add( ground );
        
        // Create an standard material for Studio space
        this.studioMaterial = new THREE.MeshStandardMaterial( { color: this.sceneColor, depthWrite: true, roughness: 1, metalness: 0} );
        this.studioMaterial.onBeforeCompile = async (shader) => {
            shader.uniforms.textureMap = {value: this.backgroundTexture}; 
            shader.uniforms.position = {value: this.texturePosition};
            shader.uniforms.scale = {value: this.textureScale};
            shader.uniforms.type = {value: this.backgroundSettings};
            shader.uniforms.size = {value: [20, 20]};
            // shader.defines.EXPAND = this.backgroundSettings == "Expand";
            // shader.defines.FILL = this.backgroundSettings == "Fill";
            // shader.defines.EXTEND = this.backgroundSettings == "Extend";
            // shader.defines.ADJUST = this.backgroundSettings == "Adjust";
            shader.vertexShader = `#define USE_UV;\n#define USE_TRANSMISSION;\nvarying vec3 vPosition;\n` + shader.vertexShader;
            //prepend the input to the shader
            shader.fragmentShader = `#define EXPAND ${this.backgroundSettings == "Expand"}\n#define EXTEND ${this.backgroundSettings == "Extend"}\n#define FILL ${this.backgroundSettings == "Fill"}\n#define ADJUST ${this.backgroundSettings == "Adjust"}\n#define USE_UV;\nuniform sampler2D textureMap;\nuniform vec2 position; uniform float scale; // Texture repetition count\nuniform float offset;// Offset for the texture in UV space;\nuniform vec2 size;\nvarying vec3 vWorldPosition;\n`+ shader.fragmentShader;
            shader.fragmentShader = 
            shader.fragmentShader.replace(
                'vec4 diffuseColor = vec4( diffuse, opacity );', 
                backgroundShaderChunk
                )
            this.studioMaterial.userData.shader = shader;           
        };

        // Create a customized standard material for Photocall space        
        this.logoTexture = new THREE.TextureLoader().load(this.logo);
        this.logoTexture.wrapS = THREE.RepeatWrapping;
        this.repeatOffset = 0;
        this.repeatCount = [20,20];
        this.repeatBackground = true;

        this.photocallMaterial = new THREE.MeshStandardMaterial( { color: this.sceneColor, depthWrite: true, roughness: 1, metalness: 0} );
        this.photocallMaterial.onBeforeCompile = async (shader) => {
            shader.uniforms.textureMap = {value: this.logoTexture}; 
            shader.uniforms.repeat = {value: this.repeatCount};
            shader.uniforms.offset = {value: this.repeatOffset};
            shader.vertexShader = '#define USE_UV;\n#define USE_TRANSMISSION;\nvarying vec3 vPosition;\n' + shader.vertexShader;            
            //prepend the input to the shader
            shader.fragmentShader = '#define USE_UV;\nuniform sampler2D textureMap\n;uniform vec2 repeat; // Texture repetition count\nuniform float offset; // Offset for the texture in UV space;\nvarying vec3 vWorldPosition;\n' + shader.fragmentShader;
            shader.fragmentShader = 
            shader.fragmentShader.replace(
                'vec4 diffuseColor = vec4( diffuse, opacity );', 
                repeatShaderChunk
                )
            this.photocallMaterial.userData.shader = shader;
            const urlParams = new URLSearchParams(window.location.search);
            
            // Default background image
            if(urlParams.has('img')) {

                const img = new Image();            
                img.onload = ( event ) => {

                    this.logo = event.target;        
                    this.setBackground( Performs.Backgrounds.PHOTOCALL, this.logo);         
                };   
                
                // Load image
                const imageURL = urlParams.get('img');
                try {
                    const response = await fetch(imageURL);
                    if (!response.ok) {
                        throw new Error(`Response status: ${response.status}`);
                    }
                    const blob = await response.blob();                    
                    const objectURL = URL.createObjectURL(blob);
                    img.src = objectURL;
                                        
                }
                catch(error) {
                    console.error(error.message, "File error!");
                };        
            }
        };

        // Create background mesh for Studio and Photocall space
        const backPlane = this.backPlane = new THREE.Mesh(createBackdropGeometry(15,10), this.studioMaterial );
        backPlane.name = 'Chroma';
        backPlane.position.z = -1;
        backPlane.receiveShadow = true;
        backPlane.castShadow = true;
        backPlane.visible = false;
        this.scene.add( backPlane );

        this.setBackground(this.background);
    }

    createRecorder() {
        
        this.animationRecorder = new AnimationRecorder(this.cameras.length, this);
        this.animationRecorder.onStartCapture = (v) => {
            if(this.gui) {
                this.gui.showCaptureModal(v);
            }
        };
        this.animationRecorder.onStopCapture = () => {
            if(this.gui) {
                this.gui.hideCaptureModal();
            }
        };    
    }
    
    loadAvatar( modelFilePath, configFile, modelRotation, avatarName, callback = null, onerror = null ) {
        if(modelFilePath.includes("models.readyplayer.me")) {
            modelFilePath+= "?morphTargets=ARKit"
        }
        this.loaderGLB.load( modelFilePath, async (glb) => {
            let model = glb.scene;
            model.quaternion.premultiply( modelRotation );
            model.castShadow = true;
            let skeleton = null;
            const morphTargets = {};

            if(avatarName == "Witch") {
                model.traverse( (object) => {
                    if ( object.isMesh || object.isSkinnedMesh ) {
                        if (object.skeleton){
                            skeleton = object.skeleton; 
                        }                    
                        if(!object.name.includes("Hat")) {
                            object.material.side = THREE.FrontSide;
                        }
                        object.frustumCulled = false;
                        object.castShadow = true;
                        object.receiveShadow = true;
                        if (object.name == "Eyelashes") // eva
                        object.castShadow = false;
                        if(object.material.map) 
                        object.material.map.anisotropy = 16;
                        if(object.name == "Hair") {
                            object.material.map = null;
                            object.material.color.set(0x6D1881);
                        }
                        if(object.name.includes("Bottom")) {
                            object.material.map = null;
                            object.material.color.set(0x000000);
                        }
                        if(object.name.includes("Top")) {
                            object.material.map = null;
                            object.material.color.set(0x000000);
                        }
                        if(object.name.includes("Shoes")) {
                            object.material.map = null;
                            object.material.color.set(0x19A7A3);
                        }
                        if(object.morphTargetDictionary) {
                            morphTargets[object.name] = object.morphTargetDictionary;
                        }
                    } else if (object.isBone) {
                        object.scale.set(1.0, 1.0, 1.0);
                    }
                } );
            }
            else {
                model.traverse( (object) => {
                    if ( object.isMesh || object.isSkinnedMesh ) {
                        if (object.skeleton){
                            skeleton = object.skeleton; 
                        }
                        object.material.side = THREE.FrontSide;
                        object.frustumCulled = false;
                        object.castShadow = true;
                        object.receiveShadow = true;
                        if (object.name == "Eyelashes") {
                            object.castShadow = false;
                        }
                        if(object.material.map) {
                            object.material.map.anisotropy = 16;
                        }
                        if(object.morphTargetDictionary) {
                            morphTargets[object.name] = object.morphTargetDictionary;
                        }
                    } else if (object.isBone) {
                        object.scale.set(1.0, 1.0, 1.0);
                    }
                });
            }

            if ( avatarName == "Kevin" ){
                let hair = model.getObjectByName( "Classic_short" );
                if( hair && hair.children.length > 1 ){ 
                    hair.children[1].renderOrder = 1; 
                }
            }
                        
            model.name = avatarName;

            this.loadedCharacters[avatarName] ={
                model, skeleton, config: null, morphTargets
            }

            // Load config file and set automatically the Script mode
            if (configFile) {
                // Read the file if it's a URL
                if(typeof(configFile) == 'string') {                    
                    const response = await fetch( configFile );
                    
                    if(response.ok) {
                        const text = await response.text()                       
                        
                        let config = JSON.parse( text );
                        config._filename = configFile;
                        this.loadedCharacters[avatarName].config = config;
                        this.scriptApp.onLoadAvatar(model, config, skeleton);
                        this.keyframeApp.onLoadAvatar(this.loadedCharacters[avatarName]);
                    }                        
                    if (callback) {
                        callback();
                    }                                      
                }
                else {
                    // Set the config file data if it's an object
                    const config = configFile;
                    this.loadedCharacters[avatarName].config = config;
                    this.scriptApp.onLoadAvatar(model, config, skeleton);
                    this.keyframeApp.onLoadAvatar(this.loadedCharacters[avatarName]);
                    
                    if (callback) {
                        callback();
                    }
                }
            }
            else {
                // If there isn't a config file, automatically set Keyframe mode as default
                this.keyframeApp.onLoadAvatar(this.loadedCharacters[avatarName]);
                if (callback) {
                    callback();
                }
            }
        }, null, (err) => {
            if(onerror) {
                onerror(err);
            }                 
        });
    }

    async animate() {

        requestAnimationFrame( this.animate.bind(this) );

        // don't let the camera to be under the ground 
        if(this.cameraMode) {
            let centerPosition = this.controls[this.camera].target.clone();
            centerPosition.y = 0;
            let groundPosition = this.cameras[this.camera].position.clone();
            groundPosition.y = 0;
            let d = (centerPosition.distanceTo(groundPosition));
    
            let origin = new THREE.Vector2(this.controls[this.camera].target.y,0);
            let remote = new THREE.Vector2(0,d); // replace 0 with raycasted ground altitude
            let angleRadians = Math.atan2(remote.y - origin.y, remote.x - origin.x);
            this.controls[this.camera].maxPolarAngle = angleRadians - 0.01;
        }

        this.controls[this.camera].update(); // needed because of this.controls.enableDamping = true
        let delta = this.clock.getDelta()         
        // delta *= this.speed;
        this.elapsedTime += delta;
        
        switch( this.mode ){
            case Performs.Modes.SCRIPT: 
                this.scriptApp.update(delta); 
                break;
            case Performs.Modes.KEYFRAME:
                this.keyframeApp.update(delta); 
                break;
            default:
                break;
        }
        
        if (this.animationRecorder && this.animationRecorder.isRecording) {
            this.animationRecorder.update(this.scene, this.cameras);
        }        

        this.renderer.render( this.scene, this.cameras[this.camera] );
  
    }

    // Force feet to touch the ground
    precomputeFeetOffset(avatarName) {
        const character = this.loadedCharacters[avatarName];
        const map = computeAutoBoneMap( character.skeleton );
        character.LToeName = character.model.getObjectByName(map.nameMap.LFoot).children[0].name;
        character.RToeName = character.model.getObjectByName(map.nameMap.RFoot).children[0].name;
        const LtoePos = character.model.getObjectByName(map.nameMap.LFoot).children[0].getWorldPosition(new THREE.Vector3());
        const RtoePos = character.model.getObjectByName(map.nameMap.RFoot).children[0].getWorldPosition(new THREE.Vector3);
      
        // Cast a ray downwards from the left toe's position
        let dir = new THREE.Vector3(0, 1, 0);
        this.raycaster.layers.enableAll()
        this.raycaster.set( new THREE.Vector3(LtoePos.x, -1, LtoePos.z), dir);
              
        const intersects = this.raycaster.intersectObjects(character.model.children[0].children, true); // Adjust based on your scene setup
        let diff = 0;
        if (intersects.length > 0) {
            // Get the ground position from the first intersection
            const groundPosition = intersects[0].point;
            diff = groundPosition.y;
        }

        character.LToePos = LtoePos;
        character.RToePos = RtoePos;
        return diff;
    }

    onMessage(event) {
        if ( !this.isAppReady ) { 
            this.pendingMessageReceived = event; 
            return; 
        }

        let data = event.data;
        
        if ( typeof( data ) == "string" ) { 
            try { 
                data =  JSON.parse( data ); 
            }
            catch( e ) { 
                if(data.includes("setImmediate")) {
                    return;
                }
                console.error("Error while parsing an external message: ", event ); 
            };
        }
        
        if ( !data ) {
            return;
        }

        if (data.askingStatus){
            event.source.postMessage({appStatus: true}, "*");
            return;
        }

        if ( Array.isArray(data) ){
            this.scriptApp.onMessage(data, (processedData) => {
                
                this.changeMode(Performs.Modes.SCRIPT);
                if(this.gui) {
                    this.gui.setBMLInputText( 
                        JSON.stringify(this.scriptApp.msg.data, function(key, val) {
                            return val.toFixed ? Number(val.toFixed(3)) : val;
                        }) 
                    );
                }
                
                if(this.autoplay) {
                    this.scriptApp.replay();
                    if(this.videoBackground) {
                        this.videoBackground.play();
                    }
                }
            }); 
            return;
        } 
                        
        if(data.type == 'bvh' || data.type == 'bvhe' || data.type == "glb" || data.type == "gltf" || data.type == "fbx") {
            this.keyframeApp.onMessage(data, () => {
                
                this.changeMode(Performs.Modes.KEYFRAME);
                if(this.gui) {
                    this.gui.refresh();
                }
                if(this.autoplay) {
                    this.keyframeApp.changePlayState(true);
                }
            });
        }
        else {
            return; 
        }
    }
    
    onWindowResize() {
        for (let i = 0; i < this.cameras.length; i++) {
            this.cameras[i].aspect = window.innerWidth / window.innerHeight;
            this.cameras[i].updateProjectionMatrix();
        }
        this.renderer.setSize( window.innerWidth, window.innerHeight );
    }

        
    changeAvatar( avatarName ) {
        if ( this.currentCharacter ) {
            this.scene.remove( this.currentCharacter.model ); // delete current model from scene
        }

        // Update the current character and add the model to the scene
        this.currentCharacter = this.loadedCharacters[avatarName];
        this.scene.add( this.currentCharacter.model ); 
        
        // Compute the distance between the feet bones and the mesh for force to touch the ground
        const diffToGround = this.precomputeFeetOffset(avatarName);
        this.loadedCharacters[avatarName].diffToGround = diffToGround;
        this.loadedCharacters[avatarName].position = this.currentCharacter.model.position.clone();
          
        // Set the avatars to each app mode
        this.scriptApp.onChangeAvatar(avatarName);
        this.keyframeApp.onChangeAvatar(avatarName);
        
        if (this.currentCharacter.config) {
            this.currentCharacter.skeleton.bones[ this.currentCharacter.config.boneMap["ShouldersUnion"] ].getWorldPosition( this.controls[this.camera].target );
            this.controls.forEach((control) => {
                control.target.copy(this.controls[this.camera].target); 
                control.saveState();
                control.update();
            });
            if(this.mode == Performs.Modes.SCRIPT && this.scriptApp.currentIdle) {
                this.scriptApp.bindAnimationToCharacter(this.scriptApp.currentIdle, this.currentCharacter.model.name);
            }
        }
        else {
            this.changeMode(Performs.Modes.KEYFRAME);
        }

        // Search the top mesh
        this.currentCharacter.model.traverse((object) => {
            if(object.isSkinnedMesh && (object.name.includes("Top") || object.name.includes("Shirt"))) {
                this.avatarShirt = object;
            }
        })
        
        if ( this.gui ){ 
            this.gui.refresh(); 
        }
    }

    toggleCameraMode() { 
        this.changeCameraMode( !this.cameraMode ); 
    }

    changeCameraMode( mode ) {

        if ( mode ) { // Free camera controls
            this.controls[this.camera].enablePan = true;
            this.controls[this.camera].minDistance = 0.1;
            this.controls[this.camera].maxDistance = 10;
            this.controls[this.camera].minAzimuthAngle = THREE.Infinity;
            this.controls[this.camera].maxAzimuthAngle = THREE.Infinity;
            this.controls[this.camera].minPolarAngle = 0.0;
            this.controls[this.camera].maxPolarAngle = Math.PI;     
        } else { // Restricted camera controls
            this.controls[this.camera].enablePan = false;
            this.controls[this.camera].minDistance = 0.7;
            this.controls[this.camera].maxDistance = 2;
            this.controls[this.camera].minAzimuthAngle = -2;
            this.controls[this.camera].maxAzimuthAngle = 2;
            this.controls[this.camera].minPolarAngle = 0.6;
            this.controls[this.camera].maxPolarAngle = 2.1;

            if ( this.currentCharacter && this.currentCharacter.config ){
                this.currentCharacter.skeleton.bones[ this.currentCharacter.config.boneMap["ShouldersUnion"] ].getWorldPosition( this.controls[this.camera].target );
            }
        }
        this.controls[this.camera].update();
        this.cameraMode = mode; 
    }

    openAtelier(name, model, config, fromFile = true, rotation = 0) {
            
        let rawConfig = config;
        if(config && !fromFile) {
            rawConfig = JSON.parse(JSON.stringify(config));
            const skeleton = this.currentCharacter.skeleton;
            const innerLocationToObjects = (locations) => {
                let result = {};
                const bindMat4 = new THREE.Matrix4();
                const bindMat3 = new THREE.Matrix3();
                for(let part in locations) {
                    
                    const obj = [];
                    const location = locations[part];
                    if( !location.parent ) {
                        location.parent = skeleton.bones[findIndexOfBoneByName(skeleton, location[0])].name;
                    }
                    let idx = findIndexOfBoneByName( skeleton, location.parent.name );
                    if ( idx < 0 ){ continue; }
    
                    obj.push(location.parent.name);
                    bindMat4.copy( skeleton.boneInverses[ idx ] ).invert();
                    obj.push( location.position.clone().applyMatrix4( bindMat4 ) ); // from mesh space to bone local space
                    
                    // check direction of distance vector 
                    if(location.direction) {
                        bindMat3.setFromMatrix4( bindMat4 );
                        obj.push( location.direction.clone().applyMatrix3( bindMat3 ) );

                    }    
                    result[part] = obj;
                }
                return result;
            }
            rawConfig.bodyController.bodyLocations = innerLocationToObjects(config.bodyController.bodyLocations);
            rawConfig.bodyController.handLocationsL = innerLocationToObjects(config.bodyController.handLocationsL);
            rawConfig.bodyController.handLocationsR = innerLocationToObjects(config.bodyController.handLocationsR);
        }
        const atelierData = [name, model, rawConfig, rotation];        
        // localStorage.setItem("atelierData", JSON.stringify(atelierData));

              
        const sendData = (data) => {

            if( !this._atelier || this._atelier.closed ) {
                this._atelier = window.open(Performs.ATELIER_URL, "Atelier");
                setTimeout(() => this._atelier.postMessage(data, "*"), 1000); // wait a while to have the page loaded (onloaded has CORS error)                
            }
            else {
                this._atelier.focus();                
                this._atelier.postMessage(data, "*");
            }
        }
        sendData(JSON.stringify(atelierData));
        // if(!this._atelier || this._atelier.closed) {
        //     this._atelier = window.open(Performs.ATELIER_URL, "Atelier");            
        // }
        // else {
        //     //this._atelier.location.reload();
        //     this._atelier.focus();
        // }
    }

    export( type = null, name = null, onError) {
        let files = [];

        switch(type){
            case 'GLB':
                let options = {
                    binary: true,
                    animations: []
                };

                const keyframeAnimations = this.keyframeApp.exportAnimations();
                // const scriptAnimations = this.scriptApp.exportAnimations();
                
                let model = this.currentCharacter.mixer._root;
                options.animations = [...keyframeAnimations];

                this.GLTFExporter.parse(model, 
                    ( gltf ) => download(gltf, (name || "animations") + '.glb', 'arraybuffer' ), // called when the gltf has been generated
                    ( error ) => { console.log( 'An error happened:', error ); if(onError) onError(error)}, // called when there is an error in the generation
                    options
                );
                break;
        }
    }
}

// Function to download data to a file
function download (data, filename, type = "text/plain") {
    const file = new Blob([data], {type: type});
    if (window.navigator.msSaveOrOpenBlob) // IE10+
        window.navigator.msSaveOrOpenBlob(file, filename);
    else { // Others
        let a = document.createElement("a");
        let url = URL.createObjectURL(file);
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(function() {
            window.URL.revokeObjectURL(url);  
        }, 0); 
    }
}

// Function to create a curved backdrop geometry
function createBackdropGeometry(width = 5, height = 5, segments = 2) {
    // Create a geometry object
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    const position = geometry.attributes.position;
    // Modify vertices to create a curved transition from floor to background
    let vertices = [];
    for (let i = 0; i < position.count; i++) {
        let vertex = new THREE.Vector3();
        vertex.fromBufferAttribute( position, i );
       
        if( vertex.y < 0) {
            vertex.z = -vertex.y; // Apply curve on Z axis
            vertex.y = 0;
        }
        vertices.push(vertex.x);
        vertices.push(vertex.y);
        vertices.push(vertex.z);
    }
    vertices = new Float32Array(vertices);
    geometry.setAttribute( 'position', new THREE.BufferAttribute( vertices, 3 ) );
    return geometry;
}


const repeatShaderChunk = 
    'vec4 diffuseColor = vec4( diffuse, 1.0 );\n\n\
    \ ivec2 texSize = textureSize(textureMap, 0);\n\
    \ float texAspect = float(texSize.x) / float(texSize.y);\n\
    \ if (vWorldPosition.y > 0.0) { \n\
    \   // Get the aspect ratio of the texture \n\
    \   // Adjust UVs based on the texture aspect ratio \n\
    \   vec2 aspectCorrectedUV = vec2(vUv.x, vUv.y * texAspect); \n\
    \   // Scale the UV coordinates by the repeat factors \n\
    \   vec2 uvScaled = aspectCorrectedUV * repeat; \n\
    \   // Use mod to wrap the UVs for repeating the texture \n\
    \   vec2 uvMod = mod(uvScaled, 1.0); \n\
    \   float shrinkFactor = 1.0 - 2.0 * offset; // Shrink the texture to fit between gaps\n\
    \   // Only apply the texture inside the non-gap area \n\
    \   if (uvMod.x > offset && uvMod.x < (1.0 - offset) && uvMod.y > offset && uvMod.y < (1.0 - offset)) { \n\
    \       // Calculate the "shrunken" UV coordinates to fit the texture within the non-gap area \n\
    \       vec2 uvShrink = (fract(uvScaled) - offset) / vec2(shrinkFactor); \n\
    \       // Compute derivatives for mipmapping \n\
    \       vec2 smooth_uv = uvScaled; \n\
    \       vec4 duv = vec4(dFdx(smooth_uv), dFdy(smooth_uv)); \n\
    \       vec4 texColor = textureGrad(textureMap, uvShrink, duv.xy, duv.zw); \n\
    \       diffuseColor = mix(texColor, diffuseColor, 1.0 - texColor.a); \n\
    \   } \n\
    \ }\n';

const backgroundShaderChunk = 
    'vec4 diffuseColor = vec4( diffuse, 1.0 );\n\n\
    \ ivec2 texSize = textureSize(textureMap, 0);\n\
    \ float texAspect = float(texSize.x) / float(texSize.y);\n\
    \ vec2 resolution = vec2(size.x, size.y*0.5 ); \n\
    \ float objAspect = resolution.x / resolution.y;\n\
    \ if (vWorldPosition.y > 0.0) { \n\
        \ vec2 smooth_uv = vUv;\n\
        \ smooth_uv.y = 2.0 * (smooth_uv.y) - 1.0; \n\
        \ if ( FILL ) {\n\
        \   // Fill all surface taking into accound proportions (if texture is bigger than the resolution, only a part is shown)\n\
        \   if( texAspect > objAspect ) {\n\
        \       smooth_uv.x = ( smooth_uv.x - 0.5) * ( objAspect / texAspect ) + 0.5;\n\
        \   }\n\
        \   else {\n\
        \       smooth_uv.y = ( smooth_uv.y - 0.5) * ( texAspect / objAspect ) + 0.5;\n\
        \   }\n\
        \ } \n\
        \ else if ( ADJUST ) {\n\
        \   // Adjust the texture in the surface (if texture is lower than the resolution, empty parts are shown)\n\
        \   if( texAspect > objAspect ) {\n\
        \       smooth_uv.y = ( smooth_uv.y - 0.5) * ( texAspect / objAspect ) + 0.5;\n\
        \   }\n\
        \   else {\n\
        \       smooth_uv.x = ( smooth_uv.x - 0.5) * ( objAspect / texAspect ) + 0.5;\n\
        \   }\n\
        \ } \n\
        \ else if ( EXTEND ) {\n\
        \   smooth_uv = (smooth_uv - 0.5) * texAspect / objAspect + 0.5;\n\
        \ } \n\
        \ // Expand the texture to adjust it into the surface (does not take into account proportions) \n\
        \ else if ( EXPAND ) {\n\
            \ // Compute derivatives for mipmapping\n\
            \ //smooth_uv.x = 2.0 * (smooth_uv.x) - 0.5; \n\
        \ } \n\
        \ smooth_uv -= position;\n\
        \ smooth_uv /= vec2(scale);\n\
        \ if( smooth_uv.x <= 1.0 && smooth_uv.x >= 0.0 && smooth_uv.y <= 1.0 && smooth_uv.y >= 0.0 ) { \n\
        \   vec4 texColor = texture2D(textureMap, smooth_uv);\n\
        \   diffuseColor = mix(diffuseColor, texColor, texColor.a);\n\
        \ }\n\
    \ }\n';
export { AnimationRecorder, Performs} 
