import { LX } from 'lexgui';

if(!LX) {
    throw("lexgui.js missing!");
}

LX.extensions.push( 'TimeBar' );
LX.extensions.push( 'VideoEditor' );

/**
 * @class TimeBar
 */

class TimeBar {

    static TIMEBAR_PLAY       = 1;
    static TIMEBAR_TRIM       = 2;

    static BACKGROUND_COLOR = LX.getThemeColor("global-branch-darker");
    static COLOR = LX.getThemeColor("global-button-color");
    static ACTIVE_COLOR = "#668ee4";

    constructor( area, type, options = {} ) {

        this.type = type;

        // Create canvas
        this.canvas = document.createElement( 'canvas' );
        this.canvas.width = area.size[0];
        this.canvas.height = area.size[1];
        area.attach( this.canvas );

        this.ctx = this.canvas.getContext("2d");
  
        this.markerWidth = options.markerWidth ?? 8;
        this.markerHeight = options.markerHeight ?? (this.canvas.height * 0.5);
        this.offset = options.offset || (this.markerWidth*0.5 + 5);

        // dimensions of line (not canvas)
        this.lineWidth = this.canvas.width - this.offset * 2;
        this.lineHeight = options.barHeight ?? 5;

        this.position = new LX.vec2( this.offset, this.canvas.height * 0.5 - this.lineHeight * 0.5);
        this.startX = this.position.x;
        this.endX = this.position.x + this.lineWidth;
        this.currentX = this.startX;

        this._draw();

        this.updateTheme();
        LX.addSignal( "@on_new_color_scheme", (el, value) => {
            // Retrieve again the color using LX.getThemeColor, which checks the applied theme
            this.updateTheme();
        } )
    }

    updateTheme(){
        TimeBar.BACKGROUND_COLOR = LX.getThemeColor("global-color-secondary");
        TimeBar.COLOR = LX.getThemeColor("global-color-quaternary");
        TimeBar.ACTIVE_COLOR = "#668ee4";
    }

    _draw() {
        const ctx = this.ctx;
        
        ctx.save();
        ctx.fillStyle = TimeBar.BACKGROUND_COLOR;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background timeline
        ctx.fillStyle = TimeBar.COLOR;
        ctx.fillRect(this.position.x, this.position.y, this.lineWidth, this.lineHeight);

        // Draw background trimed timeline
        ctx.fillStyle = TimeBar.ACTIVE_COLOR;
        ctx.fillRect(this.startX, this.position.y, this.endX - this.startX, this.lineHeight);

        ctx.restore();

        // Min-Max time markers
        this._drawTrimMarker('start', this.startX, { color: null, fillColor: TimeBar.ACTIVE_COLOR || '#5f88c9'});
        this._drawTrimMarker('end', this.endX, { color: null, fillColor: TimeBar.ACTIVE_COLOR || '#5f88c9'});
        this._drawTimeMarker('current', this.currentX, { color: '#e5e5e5', fillColor: TimeBar.ACTIVE_COLOR || '#5f88c9', width: this.markerWidth });
    }

    _drawTrimMarker(name, x, options) {

        options = options || {};

        const w = this.markerWidth;
        const h = this.markerHeight;
        const y = this.canvas.height * 0.5 - h * 0.5;

        const ctx = this.ctx;
        if(this.hovering == name) {
            // Shadow
            ctx.shadowColor = "white";
            ctx.shadowBlur = 2;
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = ctx.strokeStyle = options.fillColor || '#111' // "#FFF";

        ctx.beginPath();
        ctx.roundRect(x - w * 0.5, y, w, h, 2);
        ctx.fill();
        ctx.fillStyle = ctx.strokeStyle = options.fillColor || '#111' // "#FFF";

        ctx.strokeStyle = "white";
        ctx.beginPath();
        ctx.lineWitdh = 2;
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x, y + h - 4);
        ctx.stroke();
        ctx.shadowBlur = 0;

    }

    _drawTimeMarker(name, x, options) {

        options = options || {};

        let y = this.offset;
        const w = options.width ? options.width : (this.dragging == name ? 6 : 4);
        const h = this.canvas.height - this.offset * 2;

        let ctx = this.ctx;

        ctx.globalAlpha = 1;

        ctx.fillStyle = ctx.strokeStyle = options.fillColor || '#111' // "#FFF";


        if(this.hovering == name) {
           // Shadow
            ctx.shadowColor = "white";
            ctx.shadowBlur = 2;
        }

        // Current time line
        ctx.fillStyle = ctx.strokeStyle = "white";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + h * 0.5);
        ctx.stroke();
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle = options.fillColor || '#111' // "#FFF";


        y -= this.offset + 8;
        // Current time ball grab
        ctx.fillStyle = options.fillColor || '#e5e5e5';
        ctx.beginPath();
        ctx.roundRect(x - w * 0.5, y + this.offset, w, w, 5);

        ctx.fill();
        ctx.shadowBlur = 0;
    }

    update (x) {
        this.currentX = Math.min(Math.max(this.startX, x), this.endX);
        this._draw();

        if(this.onDraw) {
            this.onDraw();
        }
    }

    onMouseDown (e) {

        e.preventDefault();

        if(!this.canvas || e.target != this.canvas) {
            return;
        }
        const canvas = this.canvas;

        // Process mouse
        const x = e.offsetX;
        const y = e.offsetY;

        // Check if some marker is clicked
        const threshold = this.markerWidth;

        // grab trim markers only from the bottom
        if(Math.abs(this.startX - x) < threshold && this.position.y < y) {
            this.dragging = 'start';
            canvas.style.cursor = "grabbing";
        }
        else if(Math.abs(this.endX - x) < threshold && this.position.y < y) {
            this.dragging = 'end';
            canvas.style.cursor = "grabbing";
        }
        else {
            this.dragging = 'current';
            canvas.style.cursor = "grabbing";
        
            if(x < this.startX) {
                this.currentX = this.startX;
            }
            else if(x > this.endX) {
                this.currentX = this.endX;
            }
            else {
                this.currentX = x;
            }

            if(this.onChangeCurrent) {
                this.onChangeCurrent(this.currentX);
            }
        }

        this._draw();
    }

    onMouseUp (e) {
        e.preventDefault();

        this.dragging = false;
        this.hovering = false;

        if(!this.canvas) {
            return;
        }

        const canvas = this.canvas;
        canvas.style.cursor = "default";
    }

    onMouseMove (e) {
        if(!this.canvas) {
            return;
        }

        e.preventDefault();
        const canvas = this.canvas;

        // Process mouse
        const x = e.target == canvas ? e.offsetX : e.clientX - canvas.offsetLeft;
        const y = e.target == canvas ? e.offsetY : e.clientY - canvas.offsetTop;

        if(this.dragging) {
            switch(this.dragging) {
                case 'start':
                    this.startX = Math.max(this.position.x, Math.min(this.endX, x));                        
                    this.currentX = this.startX;
                    if(this.onChangeStart) {
                        this.onChangeStart(this.startX);
                    }
                    break;
                case 'end':
                    this.endX = Math.max(this.startX, Math.min(this.position.x + this.lineWidth, x));
                    this.currentX = this.endX;
                    if(this.onChangeEnd) {
                        this.onChangeEnd(this.endX);
                    }
                    break;
                default:
                    this.currentX = Math.max(this.startX, Math.min(this.endX, x));
                    break;
            }

            if(this.onChangeCurrent) {
                this.onChangeCurrent(this.currentX);
            }
        }
        else {
            const threshold = this.markerWidth * 0.5;

            if(Math.abs(this.startX - x) < threshold ) {
                this.hovering = 'start';
                canvas.style.cursor = "grab";
            }
            else if(Math.abs(this.endX - x) < threshold) {
                this.hovering = 'end';
                canvas.style.cursor = "grab";
            }
            else if(Math.abs(this.currentX - x) < threshold) {
                this.hovering = 'current';
                canvas.style.cursor = "grab";
            }
            else {
                this.hovering = false;
                canvas.style.cursor = "default";
            }
        }
        this._draw();
    }

    resize (size) {
        this.canvas.width = size[0];
        this.canvas.height = size[1];

        let newWidth = size[0] - this.offset * 2;
        newWidth = newWidth < 0.00001 ? 0.00001 : newWidth; // actual width of the line = canvas.width - offsetleft - offsetRight 
        const startRatio = (this.startX - this.offset) / this.lineWidth;
        const currentRatio = (this.currentX - this.offset) / this.lineWidth;
        const endRatio = (this.endX - this.offset) / this.lineWidth;
        
        this.lineWidth = newWidth;
        this.startX = Math.min( Math.max(newWidth * startRatio, 0), newWidth ) + this.offset;
        this.currentX = Math.min(Math.max(newWidth * currentRatio, 0), newWidth) + this.offset;
        this.endX = Math.min( Math.max(newWidth * endRatio, 0 ), newWidth) + this.offset;

        this._draw();
    }
}
LX.TimeBar = TimeBar;


/**
 * @class VideoEditor
 */

class VideoEditor {

    constructor( area, options = {} ) {

        this.playing = false;
        this.requestId = null;
        this.videoReady = false;
        this.currentTime = this.startTime = 0;
        this.startTimeString = "0:0";
        this.endTimeString = "0:0";

        this.mainArea = area;

        let videoArea = null;
        let controlsArea = null;
        if(options.controlsArea) {
            videoArea = area;
            controlsArea = options.controlsArea;
        }
        else {
            [videoArea, controlsArea] = area.split({ type: 'vertical', sizes: ["85%", null], minimizable: false, resize: false });
        }
        controlsArea.root.classList.add('lexconstrolsarea');
        
        this.cropArea = document.createElement("div");
        this.cropArea.id = "cropArea";
        this.cropArea.className = "resize-area hidden"

        this.brCrop = document.createElement("div");
        this.brCrop.className = " resize-handle br"; // bottom right
        this.cropArea.append(this.brCrop);
        
        this.crop = options.crop;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        // Create video element and load it
        let video = this.video = options.video ?? document.createElement( 'video' );
        this.loop = options.loop ?? false;
        
        if(options.src) {
            this.video.src = options.src;
            this._loadVideo(options);
        }
        
        if(options.videoArea) {
            options.videoArea.root.classList.add("lexvideoeditor");
            options.videoArea.attach(this.cropArea);
            videoArea.attach(options.videoArea);
        }
        else {
            videoArea.attach(video);
            videoArea.attach(this.cropArea);
            videoArea.root.classList.add("lexvideoeditor");
        }

        this.controlsArea = controlsArea;
        // Create playing timeline area and attach panels
        let [topArea, bottomArea] = controlsArea.split({ type: 'vertical', sizes:["50%", null], minimizable: false, resize: false });
        bottomArea.setSize([bottomArea.size[0], 40]);
        let [leftArea, controlsRight] = bottomArea.split({ type: 'horizontal', sizes:["92%", null], minimizable: false, resize: false });
        let [controlsLeft, timeBarArea] = leftArea.split({ type: 'horizontal', sizes:["10%", null], minimizable: false, resize: false });

        topArea.root.classList.add('lexbar');
        bottomArea.root.classList.add('lexbar');
        this.controlsCurrentPanel = new LX.Panel({className: 'lexcontrolspanel lextime'});
        this.controlsCurrentPanel.refresh = () => {
            this.controlsCurrentPanel.clear();
            this.controlsCurrentPanel.addLabel(this.currentTimeString, {float: "center"});
        }
        topArea.root.classList.add('lexflexarea')
        topArea.attach(this.controlsCurrentPanel);
        this.controlsCurrentPanel.refresh();

        const style = getComputedStyle(bottomArea.root);
        let padding = Number(style.getPropertyValue('padding').replace("px",""));
        this.timebar = new TimeBar(timeBarArea, TimeBar.TIMEBAR_TRIM, {offset: padding});
        
        const timeline = Object.assign({}, this.timebar);
        timeline.timeToX = (x) => { return this.timeToX(x) };
        timeline.topMargin = 0;
        //timeline.canvas.height = this.timebar.canvas.height - this.timebar.topMargin*2;
        this.propagationWindow = new PropagationWindow( timeline );
        this.propagationWindow.enabler = true;

        this.propagationWindow.draw = function() {
        if ( !this.enabler || this.timeline.playing ){ return; }

        const timeline = this.timeline;
        const ctx = timeline.canvas.getContext("2d");

        let { rightSize, leftSize, rectWidth, rectHeight, rectPosX, rectPosY } = this._getBoundingRectInnerWindow();

        rectPosY += 2;//this.timeline.offset;
        rectHeight -= 2;//this.timeline.offset;
        // compute radii
        let radii = this.visualState == PropagationWindow.STATE_SELECTED ? (timeline.trackHeight * 0.4) : timeline.trackHeight;
        let leftRadii = leftSize > radii ? radii : leftSize;
        leftRadii = rectHeight > leftRadii ? leftRadii : rectHeight;
        
        let rightRadii = rightSize > radii ? radii : rightSize;
        rightRadii = rectHeight > rightRadii ? rightRadii : rectHeight;
                
        let radiusTL, radiusBL, radiusTR, radiusBR;
        radiusTL = 2;//leftRadii;
        radiusBL = 2//this.visualState ? 0 : leftRadii;
        radiusTR = 2//rightRadii;
        radiusBR = 2//this.visualState ? 0 : rightRadii;
        const radius = 2;

        // draw window rect
        if ( this.visualState && this.opacity ){
            let gradient = ctx.createLinearGradient(rectPosX, rectPosY, rectPosX + rectWidth, rectPosY );
            gradient.addColorStop(0, this.gradientColorLimits);
            for( let i = 0; i < this.gradient.length; ++i){
                const g = this.gradient[i];
                gradient.addColorStop(g[0], this.gradientColor + "," + g[1] +")");
            }
            gradient.addColorStop(1,this.gradientColorLimits);
            ctx.fillStyle = gradient;
            ctx.globalAlpha = this.opacity;
    
            ctx.beginPath();
            ctx.moveTo(rectPosX + radius, rectPosY);
            ctx.lineTo(rectPosX + rectWidth - radius, rectPosY);
            ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY+ radius);
            ctx.lineTo(rectPosX + rectWidth, rectPosY + rectHeight - radius);
            ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - radius, rectPosY + rectHeight);
            ctx.lineTo(rectPosX + radius, rectPosY + rectHeight);
            ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - radius);
            ctx.lineTo(rectPosX, rectPosY + radius);
            ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + radius, rectPosY);
            ctx.closePath();
            // ctx.beginPath();
    
            // ctx.moveTo(rectPosX, rectPosY + radiusTL);
            // ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + radiusTL, rectPosY );
            // ctx.lineTo( rectPosX + rectWidth - radiusTR, rectPosY );
            // ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY + radiusTR );
            // ctx.lineTo( rectPosX + rectWidth, rectPosY + rectHeight - radiusBR );
            // ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - radiusBR, rectPosY + rectHeight );
            // ctx.lineTo( rectPosX + radiusBL, rectPosY + rectHeight );
            // ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - radiusBL );
    
            // ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        
        // borders
        ctx.strokeStyle = this.borderColor;

        ctx.lineWidth = 3;
            // ctx.beginPath();
            // ctx.moveTo(rectPosX + radius, rectPosY);
            // ctx.lineTo(rectPosX + rectWidth - radius, rectPosY);
            // ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY+ radius);
            // ctx.lineTo(rectPosX + rectWidth, rectPosY + rectHeight - radius);
            // ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - radius, rectPosY + rectHeight);
            // ctx.lineTo(rectPosX + radius, rectPosY + rectHeight);
            // ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - radius);
            // ctx.lineTo(rectPosX, rectPosY + radius);
            // ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + radius, rectPosY);
            // ctx.closePath();
        ctx.beginPath();
        ctx.moveTo(rectPosX, rectPosY + 15);
        ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + 15, rectPosY );
        ctx.moveTo( rectPosX + rectWidth - 15, rectPosY );
        ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY + 15 );
        ctx.moveTo( rectPosX + rectWidth, rectPosY + rectHeight - 15 );
        ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - 15, rectPosY + rectHeight );
        ctx.moveTo( rectPosX + 15, rectPosY + rectHeight );
        ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - 15 );
        ctx.stroke();
        ctx.lineWidth = 1.5;

        let lineSize = timeline.trackHeight;
        let remaining = rectHeight - timeline.trackHeight;
        let amount = 0;
        if (lineSize > 0){
            amount = Math.ceil(remaining/lineSize);
            lineSize = remaining / amount;
        }

        let start = rectPosY + timeline.trackHeight * 0.5;
        for( let i = 0; i < amount; ++i ){
            ctx.moveTo(rectPosX, start + lineSize * i + lineSize*0.3);
            ctx.lineTo(rectPosX, start + lineSize * i + lineSize*0.7);
            ctx.moveTo(rectPosX + rectWidth, start + lineSize * i + lineSize*0.3);
            ctx.lineTo(rectPosX + rectWidth, start + lineSize * i + lineSize*0.7);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        // end of borders
    }
        // Create controls panel (play/pause button and start time)
        this.controlsPanelLeft = new LX.Panel({className: 'lexcontrolspanel'});
        this.controlsPanelLeft.refresh = () => {
            this.controlsPanelLeft.clear();
            this.controlsPanelLeft.sameLine();
            this.controlsPanelLeft.addButton('', "", (v) => {
                this.playing = !this.playing;
                if(this.playing) {
                    if( this.video.currentTime + 0.000001 >= this.endTime) {
                        this.video.currentTime = this.startTime;
                    }
                    this.video.play()
                }
                else {
                    this.video.pause();
                }
                this.controlsPanelLeft.refresh();
            }, { width: '40px', icon: (this.playing ? 'Pause@solid' : 'Play@solid'), className: "justify-center"});

            this.controlsPanelLeft.addLabel(this.startTimeString, {width: 100});
            this.controlsPanelLeft.endLine();

            let availableWidth = leftArea.root.clientWidth - controlsLeft.root.clientWidth;
            this.timebar.resize([availableWidth, timeBarArea.root.clientHeight]);
        }

        this.controlsPanelLeft.refresh();
        controlsLeft.root.style.minWidth = 'fit-content';
        controlsLeft.root.classList.add(); controlsLeft.attach(this.controlsPanelLeft);

        // Create right controls panel (ens time)
        this.controlsPanelRight = new LX.Panel({className: 'lexcontrolspanel'});
        this.controlsPanelRight.refresh = () => {
            this.controlsPanelRight.clear();
            this.controlsPanelRight.addLabel(this.endTimeString, {width: 100});
        }
        this.controlsPanelRight.refresh();
        controlsRight.root.style.minWidth = 'fit-content';
        controlsRight.attach(this.controlsPanelRight);

        this.timebar.onChangeCurrent = this._setCurrentValue.bind(this);
        this.timebar.onChangeStart = this._setStartValue.bind(this);
        this.timebar.onChangeEnd = this._setEndValue.bind(this);

        window.addEventListener('resize', (v) => {
            if(this.onResize) {
                this.onResize([videoArea.root.clientWidth, videoArea.root.clientHeight]);
            }
            bottomArea.setSize([videoArea.root.clientWidth, 40]);
            let availableWidth = this.controlsArea.root.clientWidth - controlsLeft.root.clientWidth - controlsRight.root.clientWidth;
            this.timebar.resize([availableWidth, timeBarArea.root.clientHeight]);
            this.dragCropArea( { clientX: -1, clientY: -1 } );
            this.resizeCropArea( { clientX: window.screen.width, clientY: window.screen.height } );

        })

        this.onKeyUp = (event) => {
            if(this.controls && event.key == " ") {
                event.preventDefault();
                event.stopPropagation();

                this.playing = !this.playing;
                if(this.playing) {
                    if( this.video.currentTime + 0.000001 >= this.endTime) {
                        this.video.currentTime = this.startTime;
                    }
                    this.video.play();
                }
                else {
                    this.video.pause();
                }
                this.controlsPanelLeft.refresh();
            }
        }

        window.addEventListener( "keyup", this.onKeyUp);

        videoArea.onresize = (v) => {
            bottomArea.setSize([v.width, 40]);

            const ratio = this.video.clientHeight / this.video.videoHeight;
            this.cropArea.style.height = this.video.clientHeight + "px";
            this.cropArea.style.width = this.video.videoWidth * ratio + "px";
        }

        timeBarArea.onresize = (v) => {
            let availableWidth = this.controlsArea.root.clientWidth - controlsLeft.root.clientWidth - controlsRight.root.clientWidth;
            this.timebar.resize([availableWidth, v.height]);
        }

        const parent = controlsArea.parentElement ? controlsArea.parentElement : controlsArea.root.parentElement;

        // Add canvas event listeneres
        parent.addEventListener( "mousedown", (event) => {
            if(this.controls) {
                this.propagationWindow.onMouse(event);
                if(!this.propagationWindow.resizing) {
                    this.timebar.onMouseDown(event);
                }
            }
        });
        parent.addEventListener( "mouseup",   (event) => {
            if(this.controls) {
                this.propagationWindow.onMouse(event);
                if(!this.propagationWindow.resizing) {
                    this.timebar.onMouseUp(event);
                }
            }

            if( ( this.isDragging || this.isResizing ) && this.onCropArea ) {
                if( this.onCropArea ) {
                    this.onCropArea( this.getCroppedArea() );
                }
            }
            this.isDragging = false;
            this.isResizing = false;

        });
        parent.addEventListener( "mousemove", (event) => {
            if(this.controls) {
                const t = this.xToTime( event.offsetX)
                this.propagationWindow.onMouse(event, t);
                if(!this.propagationWindow.resizing) {
                    this.timebar.onMouseMove(event);
                }
            }

            if (this.isResizing) {
                this.resizeCropArea(event);
            }

            if(this.isDragging) {
                this.dragCropArea(event);
            }
        });

        this.cropArea.addEventListener('mousedown', (event) => {

            
            if (event.target === this.cropArea) {
                const rect = this.cropArea.getBoundingClientRect();
                this.isDragging = true;

                this.dragOffsetX = event.clientX - rect.left;
                this.dragOffsetY = event.clientY - rect.top;
            }
        });

        document.querySelectorAll('.resize-handle').forEach(handle => {

            handle.addEventListener('mousedown', (e) => {

                e.stopPropagation();
                if (handle.classList[1] === 'br') {
                    this.isResizing = true;
                }
            });
        });
        
        this.onChangeStart = null;
        this.onChangeEnd = null;
    }

    resizeCropArea(event) {

        const mouseX = event.clientX;
        const mouseY = event.clientY;
        
        const isCropHidden = this.cropArea.classList.contains("hidden");
        const nodes = this.cropArea.parentElement.childNodes;
        
        const rectCrop = this.cropArea.getBoundingClientRect();
        const rectVideo = this.video.getBoundingClientRect();
        let width = Math.max( 0, Math.min( mouseX - rectCrop.left, rectVideo.width ) );
        let height = Math.max( 0, Math.min( mouseY - rectCrop.top, rectVideo.height ) );
        if ( (rectCrop.left + width) > rectVideo.right ){
            width = Math.min( rectVideo.width, rectVideo.right - rectCrop.left);
        }
        if ( (rectCrop.top + height) > rectVideo.bottom ){
            height = Math.min( rectVideo.height, rectVideo.bottom - rectCrop.top);
        }

        if ( !isCropHidden ){ 
            for( let i = 0; i < nodes.length; i++ ) {
                if( nodes[i] != this.cropArea ) {                    
                    const rectEl = nodes[i].getBoundingClientRect();
                    nodes[i].style.webkitMask = `linear-gradient(#000 0 0) ${rectCrop.x - rectEl.left}px ${ rectCrop.y - rectEl.top }px / ${width}px ${height}px, linear-gradient(rgba(0, 0, 0, 0.3) 0 0)`;
                    nodes[i].style.webkitMaskRepeat = 'no-repeat';
                }
            }
        }

        this.cropArea.style.width = width + "px";
        this.cropArea.style.height = height + "px";
    }

    dragCropArea( event ) {
        const rectVideo = this.video.getBoundingClientRect();
        const rectCrop = this.cropArea.getBoundingClientRect();

        let x = event.clientX - this.dragOffsetX;
        let y = event.clientY - this.dragOffsetY;

        if( x < rectVideo.left ) {
            x = rectVideo.left;
        }

        if( x + rectCrop.width > rectVideo.right ) {
            x = Math.max( rectVideo.left, rectVideo.right - rectCrop.width);
        }

        if( y < rectVideo.top ) {
            y = rectVideo.top;
        }
        
        if( y + rectCrop.height > rectVideo.bottom ) {
            y = Math.max( rectVideo.top, rectVideo.bottom - rectCrop.height );
        }

        if ( !this.cropArea.classList.contains("hidden") ){
            const nodes = this.cropArea.parentElement.childNodes;   
            for( let i = 0; i < nodes.length; i++ ) {
                if( nodes[i] != this.cropArea ) {
                    const rectEl = nodes[i].getBoundingClientRect();
                    nodes[i].style.webkitMask = `linear-gradient(#000 0 0) ${x - rectEl.left}px ${y - rectEl.top}px / ${rectCrop.width}px ${rectCrop.height}px, linear-gradient(rgba(0, 0, 0, 0.3) 0 0)`;
                    nodes[i].style.webkitMaskRepeat = 'no-repeat';
                }
            }
        }

        const parentRect = this.cropArea.parentElement.getBoundingClientRect();
        this.cropArea.style.left = x - parentRect.left + "px";
        this.cropArea.style.top = y - parentRect.top + "px";

    }

    async _loadVideo( options = {} ) {
        this.videoReady = false;
        while(this.video.duration === Infinity || isNaN(this.video.duration) || !this.timebar) {
            await new Promise(r => setTimeout(r, 1000));
            this.video.currentTime = 10000000 * Math.random();
        }
        this.video.currentTime = 0.01; // BUG: some videos will not play unless this line is present 
        
        // Duration can change if the video is dynamic (stream). This function is to ensure to load all buffer data
        const forceLoadChunks =  () => {    
            const state = this.videoReady;
            if(this.video.readyState > 3) {
                this.videoReady = true;
            }
            if(!state) {
                this.video.currentTime = this.video.duration;
            }
        }

        this.video.addEventListener( "canplaythrough", forceLoadChunks, {passive :true} );

        this.video.ondurationchange = (v) => {
            if( this.video.duration != this.endTime ) {

                this.video.currentTime = this.startTime;
                console.log("duration changed from", this.endTime, " to ", this.video.duration);
                this.endTime = this.video.duration;
                const x = this.timeToX(this.endTime);
                this._setEndValue(x);
            }
            this.video.currentTime = this.startTime;
        }
 
        this.timebar.startX = this.timebar.position.x;
        this.timebar.endX = this.timebar.position.x + this.timebar.lineWidth;

        this.endTime = this.video.duration;
        
        this._setEndValue(this.timebar.endX);
        this._setStartValue(this.timebar.startX);
        this.timebar.currentX = this.timeToX(this.video.currentTime);
        this._setCurrentValue(this.timebar.currentX, false);
        this.timebar.update(this.timebar.currentX);
        
        if ( !this.requestId ){ // only have one update on flight
            this._update();
        } 
        this.controls = options.controls ?? true;
        
        if ( !this.controls ) {
            this.hideControls();
        }

        this.cropArea.style.height = this.video.clientHeight + "px";
        this.cropArea.style.width =  this.video.clientWidth + "px";
        this.resizeCropArea( { clientX: window.screen.width, clientY: window.screen.height } );
        this.dragCropArea( { clientX: -1, clientY: -1 } );

        if( this.crop ) {
            this.showCropArea();
        }else{
            this.hideCropArea();
        }

        window.addEventListener( "keyup", this.onKeyUp);

        if( this.onVideoLoaded ) {
            this.onVideoLoaded(this.video);
        }
    }

    _update () {

        if(this.onDraw) {
            this.onDraw();
        }
        this.propagationWindow.draw();
        if(this.playing) {
            if( this.video.currentTime + 0.000001 >= this.endTime) {
                this.video.pause();
                if(!this.loop) {
                    this.playing = false;
                    this.controlsPanelLeft.refresh();
                }
                else {
                    this.video.currentTime = this.startTime;
                    this.video.play();
                }
            }
            const x = this.timeToX(this.video.currentTime);
            this._setCurrentValue(x, false);
            this.timebar.update(x);
        }

        this.requestId = requestAnimationFrame(this._update.bind(this));
    }

    xToTime (x) {
        return ((x - this.timebar.offset) / (this.timebar.lineWidth)) *  this.video.duration;
    }

    timeToX (time) {
        return (time / this.video.duration) *  (this.timebar.lineWidth) + this.timebar.offset;
    }

    _setCurrentValue ( x, updateTime = true ) {
        const t = this.xToTime(x);

        if(updateTime) {
            this.video.currentTime = t;
            this.propagationWindow.setTime(t);
        }
        //console.log( "Computed: " + t)
        let mzminutes = Math.floor(t / 60);
        let mzseconds = Math.floor(t - (mzminutes * 60));
        let mzmiliseconds = Math.floor((t - mzseconds)*100);

        mzmiliseconds = mzmiliseconds < 10 ? ('0' + mzmiliseconds) : mzmiliseconds;
        mzseconds = mzseconds < 10 ? ('0' + mzseconds) : mzseconds;
        mzminutes = mzminutes < 10 ? ('0' + mzminutes) : mzminutes;
        this.currentTimeString = mzminutes+':'+mzseconds+'.'+mzmiliseconds;
        this.controlsCurrentPanel.refresh();

        if(this.onSetTime) {
            this.onSetTime(t);
        }
    }

    _setStartValue ( x ) {
        const t = this.xToTime(x);
        this.startTime = this.video.currentTime = t;

        let mzminutes = Math.floor(t / 60);
        let mzseconds = Math.floor(t - (mzminutes * 60));
        let mzmiliseconds = Math.floor((t - mzseconds)*100);

        mzmiliseconds = mzmiliseconds < 10 ? ('0' + mzmiliseconds) : mzmiliseconds;
        mzseconds = mzseconds < 10 ? ('0' + mzseconds) : mzseconds;
        mzminutes = mzminutes < 10 ? ('0' + mzminutes) : mzminutes;
        this.startTimeString =  mzminutes+':'+mzseconds+'.'+mzmiliseconds;
        this.controlsPanelLeft.refresh();
        if(this.onSetTime) {
            this.onSetTime(t);
        }
        
        if(this.onChangeStart) {
            this.onChangeStart(t);
        }
    }

    _setEndValue ( x ) {
        const t = this.xToTime(x);
        this.endTime = this.video.currentTime = t;

        let mzminutes = Math.floor(t / 60);
        let mzseconds = Math.floor(t - (mzminutes * 60));
        let mzmiliseconds = Math.floor((t - mzseconds)*100);

        mzmiliseconds = mzmiliseconds < 10 ? ('0' + mzmiliseconds) : mzmiliseconds;
        mzseconds = mzseconds < 10 ? ('0' + mzseconds) : mzseconds;
        mzminutes = mzminutes < 10 ? ('0' + mzminutes) : mzminutes;

        this.endTimeString =  mzminutes+':'+mzseconds+'.'+mzmiliseconds;
        this.controlsPanelRight.refresh();
        if(this.onSetTime) {
            this.onSetTime(t);
        }

        if(this.onChangeEnd) {
            this.onChangeEnd(t);
        }
    }

    getStartTime ( ) {
        return this.startTime;
    }

    getEndTime ( ) {
        return this.endTime;
    }

    getTrimedTimes ( ) {
        return {start: this.startTime, end: this.endTime};
    }

    getCroppedArea ( ) {
        return this.cropArea.getBoundingClientRect();
    }

    showCropArea ( ) {
        this.cropArea.classList.remove("hidden");

        const nodes = this.cropArea.parentElement.childNodes;
        const rect = this.cropArea.getBoundingClientRect();
        for( let i = 0; i < nodes.length; i++ ) {
            if( nodes[i] != this.cropArea ) {
               const rectEl = nodes[i].getBoundingClientRect();
                nodes[i].style.webkitMask = `linear-gradient(#000 0 0) ${rect.left - rectEl.left}px ${rect.top - rectEl.top}px / ${rect.width}px ${rect.height}px, linear-gradient(rgba(0, 0, 0, 0.3) 0 0)`;
                nodes[i].style.webkitMaskRepeat = 'no-repeat';
            }
        }
    }

    hideCropArea ( ) {
        this.cropArea.classList.add("hidden");

        const nodes = this.cropArea.parentElement.childNodes;
        for( let i = 0; i < nodes.length; i++ ) {
            if( nodes[i] != this.cropArea ) {       
                nodes[i].style.webkitMask = "";
                nodes[i].style.webkitMaskRepeat = 'no-repeat';
            }
        }
    }

    showControls ( ) {
        this.controls = true;
        this.controlsArea.show();
    }

    hideControls ( ) {
        this.controls = false;
        this.controlsArea.hide();
    }

    stopUpdates(){

        if(this.requestId) {
            cancelAnimationFrame(this.requestId);
            this.requestId = null;
        }
    }

    unbind ( ) {
        this.stopUpdates();
        
        this.video.pause();
        this.playing = false;
        this.controlsPanelLeft.refresh();
        this.video.src = "";

        window.removeEventListener("keyup", this.onKeyUp);
    }
}

LX.VideoEditor = VideoEditor;

class PropagationWindow {

    static STATE_BASE = 0;
    static STATE_HOVERED = 1;
    static STATE_SELECTED = 2;
    /*
     * @param {Lexgui timeline} timeline must be valid 
     */
    constructor( timeline ){

        this.savedCurves = []; // array of { imageSrc, values }
        this.timeline = timeline; // will provide the canvas
        
        this.curveWidget = null; 
        this.visualState = false;
        
        this.enabler = false;
        this.resizing = 0; // -1 resizing left, 0 nothing, 1 resizing right

        this.time = 0; // seconds
        this.rightSide = 1; // seconds
        this.leftSide = 1;  // seconds

        this.opacity = 0.6;
        this.lexguiColor = '#273162';
        this.gradientColorLimits = "rgba( 39, 49, 98, 0%)"; // relies on lexgui input
        this.gradientColor = "rgba( 39, 49, 98"; // relies on lexgui input
        this.borderColor = LX.getThemeColor( "global-text-secondary" );
        this.gradient = [ [0.5,1] ]; // implicit 0 in the borders. Shares array reference with curve Widget
        // radii = 100;

        // create curve Widget
        const bgColor = "#cfcdcd"; // relies on lexgui input
        const pointsColor = "#273162"; // relies on lexgui input
        const lineColor = "#1c1c1d"; // relies on lexgui input
        const lpos = timeline.timeToX( this.time - this.leftSide );
        const rpos = timeline.timeToX( this.time + this.rightSide );

        // curveWidget and this.gradient share the same array reference
        this.curveWidget = new LX.Curve( null, this.gradient, (v,e) => {
                if ( v.length <= 0){
                    this.curveWidget.curveInstance.element.value = this.gradient = [[0.5,1]];
                    this.curveWidget.curveInstance.redraw();
                }
            },
            {xrange: [0,1], yrange: [0,1], allowAddValues: true, moveOutAction: LX.CURVE_MOVEOUT_DELETE, smooth: 0, signal: "@propW_gradient", width: rpos-lpos -0.5, height: 25, bgColor, pointsColor, lineColor } 
        );
        const curveElement = this.curveWidget.root; 
        curveElement.style.width = "fit-content";
        curveElement.style.height = "fit-content";
        curveElement.style.position = "fixed";
        curveElement.style.borderRadius = "0px";
        curveElement.children[0].style.borderRadius = "0px 0px " + timeline.trackHeight*0.4 +"px " + timeline.trackHeight*0.4 +"px";
        curveElement.style.zIndex = "0.5";
        curveElement.style.padding = "0px";

        // hidden, used to save images of the window values
        this.helperCurves = new LX.Curve( null, this.gradient, (v,e) => {
                if ( v.length <= 0){
                    this.curveWidget.curveInstance.element.value = this.gradient = [[0.5,1]];
                    this.curveWidget.curveInstance.redraw();
                }
            },
            {xrange: [0,1], yrange: [0,1], disabled: true, bgColor, pointsColor:"#0003C2FF", lineColor } 
        );
        const helper = this.helperCurves.root; 
        helper.remove(); // from dom
        helper.style.width = "fit-content";
        helper.style.height = "fit-content";
        helper.style.position = "fixed";
        const helperCanvas = this.helperCurves.curveInstance.canvas;
        helperCanvas.width = 400;
        helperCanvas.style.width = "400px";
        helperCanvas.height = 30;
        helperCanvas.style.height = "30px";


        const computeGradientFromFormula = (f, df) => {
            let left = [];
            let right = [];
            const defaultDelta = 0.1;
            let status = true;
            for( let i = 0; status; ){
                if( i > 1 ){
                    i = 1;
                    status = false;
                }
                let y = f(i);

                left.push( [ Math.clamp( i*0.5, 0 , 0.5 ) , Math.clamp(y, 0,1)] );
                if ( status ){
                    right.push( [Math.clamp( 1-i*0.5, 0.5 , 1 ), Math.clamp(y, 0,1)] )
                }
                let der = Math.abs(df(i));
                der = der > 0 ? Math.clamp( defaultDelta / der, 0.08, 0.2 ) : 0.05; // modify delta to add to 'i' depending on derivative
                i += der;
            }

            let result = left.concat(right.reverse());
            this.saveGradient( result, 1, 1 );
        }

        
        // cards are drawn from last to first. Make lower cards the least expected curves
        computeGradientFromFormula( (x) =>{ return 1-x*x*x*x }, (x) =>{ return -4*x*x*x } );
        computeGradientFromFormula( (x) =>{ return 1-(Math.sin(x * Math.PI - Math.PI*0.5) *0.5 + 0.5); }, (x) =>{ return -Math.cos(x * Math.PI - Math.PI*0.5) *0.5 * Math.PI; } );
        computeGradientFromFormula( (x) =>{ return x*x*x*x }, (x) =>{ return 4*x*x*x } );
        computeGradientFromFormula( (x) =>{ return x*x }, (x) =>{ return 2*x } );
        computeGradientFromFormula( (x) =>{ return Math.sin(x * Math.PI - Math.PI*0.5) *0.5 + 0.5; }, (x) =>{ return Math.cos(x * Math.PI - Math.PI*0.5) *0.5 * Math.PI; } );
        computeGradientFromFormula( (x) =>{ let a = 1-x; return 1-a*a*a*a }, (x) =>{ let a = 1-x; return -4*a*a*a } );
        computeGradientFromFormula( (x) =>{ let a = 1-x; return 1-a*a }, (x) =>{ let a = 1-x; return -2*a } );
        this.saveGradient( [[0.5,1]], 1, 1 );
        
        this.setGradient([[0.5,1]]); 
        this.makeCurvesSelectorMenu();
        
        this.updateTheme();
        LX.addSignal( "@on_new_color_scheme", (el, value) => {
            // Retrieve again the color using LX.getThemeColor, which checks the applied theme
            this.updateTheme();
        } )
    }

    makeCurvesSelectorMenu(){

        let prevStates = 0;
        if ( this.sideMenu ){
            prevStates |= !this.sideMenu.root.classList.contains("hidden"); 
            prevStates |= (!this.panelCurves.root.classList.contains("hidden")) << 1;
            prevStates = prevStates * (this.visualState == PropagationWindow.STATE_SELECTED);

            this.sideMenu.clear();
            this.sideMenu.root.remove();
            this.panelCurves.clear();
            this.panelCurves.root.remove();
        }
        const sideMenu = this.sideMenu = new LX.Panel( {id: "PropagationWindowSideOptions", width: "50px", height: "75px" } );
        sideMenu.root.style.zIndex = "0.5";
        sideMenu.root.style.position = "fixed";
        sideMenu.root.background = "transparent";
        
        sideMenu.addButton(null, "", (v,e)=>{ 
            this.panelCurves.root.classList.toggle("hidden");
            this.updateCurve();
        }, { icon: "ChartSpline", title: "Show saved curves" } );
        
        sideMenu.addButton(null, "", (v,e)=>{ 
            this.saveGradient( this.gradient, this.leftSide, this.rightSide );
            this.makeCurvesSelectorMenu(); // overkill for just adding a card to the panel
            this.updateCurve();
            LX.toast("Propagation Window Saved", null, { timeout: 7000 } );

        }, { icon: "Save", title: "Save current curve" } );

        const panelCurves  = this.panelCurves = new LX.Panel( {id:"panelCurves", width:"auto", height: "auto"});
        panelCurves.root.background = "transparent";
        for( let i = this.savedCurves.length-1; i > -1; --i ){
            const values = this.savedCurves[i].values;
            let card = panelCurves.addCard(null, { img: this.savedCurves[i].imgURL, callback:(v,e)=>{
                const gradient = JSON.parse(JSON.stringify(values));
                this.recomputeGradient( gradient, 1, 1, this.leftSide, this.rightSide ); // stored gradient is centered. Readjust to current window size
                this.setGradient( gradient ); 
            }, className: "p-1 my-0"});
            card.root.children[0].children[1].remove();
            card.root.children[0].children[0].style.height = "auto";
            card.root.children[0].classList.add("my-0");
            card.root.children[0].classList.add("pb-1");
            card.root.children[0].children[0].classList.add("my-0");
            card.root.children[0].children[0].classList.add("p-0");
            card.root.classList.add("leading-3");
            
        }
        panelCurves.root.style.zIndex = "0.5";
        panelCurves.root.style.position = "fixed";
        panelCurves.root.style.background = "var(--global-color-tertiary)";
        panelCurves.root.style.borderRadius = "10px";
        panelCurves.root.classList.add("showScrollBar");

        if ( !(prevStates & 0x01) ){
            sideMenu.root.classList.add("hidden");
        }
        if ( !(prevStates & 0x02) ){
            panelCurves.root.classList.add("hidden");
        }

        document.body.appendChild(sideMenu.root);
        document.body.appendChild(panelCurves.root);
    }

    updateTheme(){
        this.borderColor = LX.getThemeColor( "global-text-secondary" );
    }

    setEnabler( v ){
        this.enabler = v;
        if(!v) {
            this.setVisualState( PropagationWindow.STATE_BASE );
        }
        LX.emit( "@propW_enabler", this.enabler );
    }
    
    toggleEnabler(){
        this.setEnabler( !this.enabler );
    }

    saveGradient( gradientToSave, leftSize, rightSize ){
        const gradient = JSON.parse(JSON.stringify(gradientToSave));
        this.recomputeGradient(gradient, leftSize, rightSize, 1,1 ); // centre gradient

        // for some reason width is sometimes 0
        this.helperCurves.curveInstance.canvas.width = 400;
        this.helperCurves.curveInstance.canvas.style.width = "400px";
        this.helperCurves.curveInstance.canvas.height = 30;
        this.helperCurves.curveInstance.canvas.style.height = "30px";
        
        this.helperCurves.curveInstance.element.value = gradient;
        this.helperCurves.curveInstance.redraw();

        // vertical line that separates Left and Right sides of the window
        const ctx = this.helperCurves.curveInstance.canvas.getContext("2d");
        ctx.strokStyle = "black";
        ctx.beginPath();
        ctx.moveTo(200,0);
        ctx.lineTo(200,2.5);
        ctx.moveTo(200,7.5);
        ctx.lineTo(200,12.5);
        ctx.moveTo(200,17.5);
        ctx.lineTo(200,22.5);
        ctx.moveTo(200,27.5);
        ctx.lineTo(200,30);
        ctx.stroke();

        let c ={
            imgURL: this.helperCurves.curveInstance.canvas.toDataURL("image/png"),
            values: gradient
        }
        this.savedCurves.push(c);
    }

    /**
     * set curve widget values
     * @param {*} newGradient [ [x,y] ].   0 < x < 0.5 left side of window. 0.5 < x < 1 right side of window
     */
    setGradient( newGradient ){
        this.curveWidget.curveInstance.element.value = this.gradient = newGradient;
        this.curveWidget.curveInstance.redraw();
    }

    /**
     * The window has a left side and a right side. They might be of different magnitudes. Since gradient's domain is [0,1], the midpoint will not always be in the middle
     * @param {Array} gradient 
     * @param {Num} oldLeft > 0
     * @param {Num} oldRight > 0
     * @param {Num} newLeftSide > 0
     * @param {Num} newRightSide > 0
     */
    recomputeGradient( gradient, oldLeft, oldRight, newLeftSide, newRightSide ){
        let g = gradient;

        const oldMid = oldLeft / (oldLeft + oldRight);
        const newMid = newLeftSide / (newLeftSide + newRightSide);
        for( let i = 0; i < g.length; ++i ){
            let gt = g[i][0]; 
            if ( gt <= oldMid ){
                g[i][0] = ( gt / oldMid ) * newMid;
            }
            else{
            g[i][0] = ( (gt - oldMid) / (1-oldMid)) * (1-newMid) + newMid ;
            }
        }
    }

    setTimeline( timeline ){
        this.timeline = timeline;
        
        this.curveWidget.root.remove(); // remove from dom, wherever this is
        if(this.visualState){
            const area = this.timeline.canvasArea ? this.timeline.canvasArea.root : this.timeline.canvas;
            area.appendChild( this.curveWidget.root );
            this.updateCurve( true );
        }
    }

    /**
     * 
     * @param {Num} newLeftSide > 0, size of left side
     * @param {Num} newRightSide > 0, size of right side 
     */
    setSize( newLeftSide, newRightSide ){
        this.recomputeGradient(this.gradient, this.leftSide, this.rightSide, newLeftSide, newRightSide);
        this.leftSide = newLeftSide;
        this.rightSide = newRightSide;
        if( this.visualState > PropagationWindow.STATE_BASE ){
            this.updateCurve(true);
        }
    }

    setTime( time ){
        this.time = time;
        this.updateCurve(); // update only position
    }

    onOpenConfig(dialog){
        dialog.addToggle("Enable", this.enabler, (v) =>{
            this.setEnabler(v);
        }, { className: "success", label: "", signal: "@propW_enabler"});

        dialog.sameLine();
        let w = dialog.addNumber("Min", this.leftSide, (v) => {
            this.setSize( v, this.rightSide );
        }, {min: 0.001, step: 0.001, units: "s", precision: 3, signal: "@propW_minT", width:"50%"});
        w.root.style.paddingLeft = 0;
        dialog.addNumber("Max", this.rightSide, (v) => {
            this.setSize( this.leftSide, v );
        }, {min: 0.001, step: 0.001, units: "s", precision: 3, signal: "@propW_maxT", width:"50%"});
        dialog.endLine();

        dialog.addColor("Color", this.lexguiColor, (value, event) => {
            this.lexguiColor = value;
            let rawColor = parseInt(value.slice(1,7), 16);
            let color = "rgba(" + ((rawColor >> 16) & 0xff) + "," + ((rawColor >> 8) & 0xff) + "," + (rawColor & 0xff);
            this.gradientColorLimits = color + ",0%)"; 
            this.gradientColor = color;

            this.curveWidget.curveInstance.element.pointscolor = color + ")";
            this.curveWidget.curveInstance.redraw();

            this.opacity = parseInt(value[7]+value[8], 16) / 255.0;
        }, {useAlpha: true});
    }

    onMouse( e, time ){

        if( !this.enabler ){ return false; }

        const timeline = this.timeline;
        e.localX = e.localX || e.offsetX;
        e.localY = e.localY || e.offsetY;
        const windowRect = this._getBoundingRectInnerWindow();
        const lpos = windowRect.rectPosX;
        const rpos = windowRect.rectPosX + windowRect.rectWidth;

        const timelineState = timeline.grabbing | timeline.grabbingTimeBar | timeline.grabbingScroll | timeline.movingKeys | timeline.boxSelection;
        
        const isInsideResizeLeft = Math.abs( e.localX - lpos ) < 7 && e.localY > windowRect.rectPosY;
        const isInsideResizeRight = Math.abs( e.localX - rpos ) < 7 && e.localY > windowRect.rectPosY;

        if ( !timelineState && ( isInsideResizeLeft || isInsideResizeRight ) ){
            timeline.canvas.style.cursor = "col-resize";
        }
        
        if ( e.type == "mousedown" && (isInsideResizeLeft || isInsideResizeRight) ){
            this.resizing = isInsideResizeLeft ? -1 : 1; 
            this.sideMenu.root.style.pointerEvents = "none";
            this.panelCurves.root.style.pointerEvents = "none";
            this.curveWidget.root.style.pointerEvents = "none";
        }

        if( e.localX >= lpos && e.localX <= rpos && e.localY > windowRect.rectPosY && e.localY <= (windowRect.rectPosY + windowRect.rectHeight)) {
            if( this.visualState == PropagationWindow.STATE_BASE ){
                this.setVisualState( PropagationWindow.STATE_HOVERED );
            }
        }
        else if(!this.resizing) { // outside of window
            
            if(e.type == "mousedown" && this.visualState && e.localY > timeline.lastTrackTreesWidgetOffset ) {
                this.setVisualState( PropagationWindow.STATE_BASE );
            }
            else if( this.visualState == PropagationWindow.STATE_HOVERED ){
                this.setVisualState( PropagationWindow.STATE_BASE );
            }
        }

        if ( this.resizing && e.type == "mousemove" ){
            if ( !e.buttons ){ // mouseUp outside the canvas. Stop resizing
                this.resizing = 0;
                this.sideMenu.root.style.pointerEvents = "";
                this.panelCurves.root.style.pointerEvents = "";
                this.curveWidget.root.style.pointerEvents = "";
            }
            else if ( this.resizing == 1 ){
                const t = Math.max( 0.001, time - this.time ); 
                this.setSize( this.leftSide, t );
                LX.emit("@propW_maxT", t, true); 
            }else{
                const t = Math.max( 0.001, this.time - time );
                this.setSize( t, this.rightSide );
                LX.emit("@propW_minT", t); 
            }
        }
        else if(timeline.grabbing && this.visualState) {
            this.updateCurve(); // update position of curvewidget
        }

        if ( e.type == "wheel" ){
            this.updateCurve(true);
        }

        if( this.resizing ){
            timeline.grabbing = false;
            timeline.grabbingTimeBar = false;
            timeline.grabbingScroll = false;
            timeline.movingKeys = false;
            timeline.timeBeforeMove = null;
            timeline.boxSelection = false;
            if(timeline.unHoverAll) {
                timeline.unHoverAll();
            }

            if ( e.type == "mouseup" ){
                this.resizing = 0;
                this.sideMenu.root.style.pointerEvents = "";
                this.panelCurves.root.style.pointerEvents = "";
                this.curveWidget.root.style.pointerEvents = "";
            }
        }
        
        return true;
    }

    onDblClick( e ) {
        if ( !this.enabler ){ return; }

        const timeline = this.timeline;
        const lpos = timeline.timeToX( this.time - this.leftSide );
        const rpos = timeline.timeToX( this.time + this.rightSide );

        if( e.localX >= lpos && e.localX <= rpos && e.localY > timeline.topMargin) {
            timeline.grabbing = false;
            this.setVisualState( PropagationWindow.STATE_SELECTED );
        }
    }

    setVisualState( visualState = PropagationWindow.STATE_BASE ){
        if ( this.visualState == visualState ){
            return;
        }

        
        if  ( visualState == PropagationWindow.STATE_SELECTED ){
            this.sideMenu.root.classList.remove("hidden");
            this.sideMenu.root.style.pointerEvents = "";
            this.panelCurves.root.style.pointerEvents = "";
            this.curveWidget.root.style.pointerEvents = "";
        }else{
            this.panelCurves.root.classList.add("hidden");
            this.sideMenu.root.classList.add("hidden");
            this.sideMenu.root.style.pointerEvents = "";
            this.panelCurves.root.style.pointerEvents = "";
            this.curveWidget.root.style.pointerEvents = "";
        }
        
        if (visualState == PropagationWindow.STATE_BASE){
            this.visualState = PropagationWindow.STATE_BASE;
            this.curveWidget.root.remove(); // detach from timeline (if any)
        }else{
            const oldVisibility = this.visualState;
            this.visualState = visualState;

            if ( oldVisibility == PropagationWindow.STATE_BASE ){ // only do update on visibility change
                const area = this.timeline.canvasArea ? this.timeline.canvasArea.root : this.timeline.canvas;

                area.appendChild( this.curveWidget.root );
                this.updateCurve(true);
            }
        }
    }

    updateCurve( updateSize = false ) {
        if( !(this.enabler && this.visualState) ){ return false; }

        const timeline = this.timeline;

        const windowRect = this._getBoundingRectInnerWindow();

		let areaRect = timeline.canvas.getBoundingClientRect();

        this.curveWidget.root.style.left = areaRect.x + windowRect.rectPosX + "px";
        this.curveWidget.root.style.top = areaRect.y + windowRect.rectPosY + windowRect.rectHeight -2 + "px";

        if(updateSize) {
            const canvas = this.curveWidget.curveInstance.canvas;
            canvas.width = windowRect.rectWidth;
            canvas.style.width = windowRect.rectWidth + "px";


            const radii = timeline.trackHeight * 0.4;
			let leftRadius = windowRect.leftSize > radii ? radii : windowRect.leftSize;
	        leftRadius = windowRect.rectHeight > leftRadius ? leftRadius : (windowRect.rectHeight*0.5);
        
	        let rightRadius = windowRect.rightSize > radii ? radii : windowRect.rightSize;
	        rightRadius = windowRect.rectHeight > rightRadius ? rightRadius : (windowRect.rectHeight*0.5);

			canvas.style.borderBottomLeftRadius = leftRadius + "px";
			canvas.style.borderBottomRightRadius = rightRadius + "px";

            this.curveWidget.curveInstance.redraw();
        }
        
        if ( this.visualState ){
            this.sideMenu.root.style.left = areaRect.x + windowRect.rectPosX + windowRect.rectWidth + "px";
            this.sideMenu.root.style.top = areaRect.y + windowRect.rectPosY + "px";
            if ( !this.panelCurves.root.classList.contains("hidden") ){
                this.panelCurves.root.style.left = areaRect.x + windowRect.rectPosX + windowRect.rectWidth + 50 +"px";
                this.panelCurves.root.style.top = areaRect.y + windowRect.rectPosY + 10 + "px";       
                this.panelCurves.root.style.maxHeight = windowRect.rectHeight - 10 + "px";       
            }
        }


    }

    _getBoundingRectInnerWindow(){
        const timeline = this.timeline;
        let rightSize = timeline.timeToX(this.rightSide) - timeline.timeToX(0); 
        let leftSize = timeline.timeToX(this.leftSide) - timeline.timeToX(0);

        let rectWidth = leftSize + rightSize;
		let rectHeight =  timeline.leftPanel ? Math.min(
            timeline.canvas.height - timeline.topMargin - 2 - (this.visualState ? this.curveWidget.curveInstance.canvas.clientHeight : 0), 
            timeline.leftPanel.root.children[1].children[0].clientHeight - timeline.leftPanel.root.children[1].scrollTop + timeline.trackHeight*0.5
        ) : timeline.canvas.height - timeline.topMargin - 2 - (this.visualState ? this.curveWidget.curveInstance.canvas.clientHeight : 0);
        rectHeight = Math.max( rectHeight, 0 );

        let rectPosX = timeline.timeToX( this.time - this.leftSide);
        let rectPosY = timeline.topMargin + 1;

        return { rightSize, leftSize, rectWidth, rectHeight, rectPosX, rectPosY };
    }

    draw( ){
        if ( !this.enabler || this.timeline.playing ){ return; }

        const timeline = this.timeline;
        const ctx = timeline.canvas.getContext("2d");

        let { rightSize, leftSize, rectWidth, rectHeight, rectPosX, rectPosY } = this._getBoundingRectInnerWindow();

        // compute radii
        let radii = this.visualState == PropagationWindow.STATE_SELECTED ? (timeline.trackHeight * 0.4) : timeline.trackHeight;
        let leftRadii = leftSize > radii ? radii : leftSize;
        leftRadii = rectHeight > leftRadii ? leftRadii : rectHeight;
        
        let rightRadii = rightSize > radii ? radii : rightSize;
        rightRadii = rectHeight > rightRadii ? rightRadii : rectHeight;
                
        let radiusTL, radiusBL, radiusTR, radiusBR;
        radiusTL = leftRadii;
        radiusBL = this.visualState ? 0 : leftRadii;
        radiusTR = rightRadii;
        radiusBR = this.visualState ? 0 : rightRadii;

        // draw window rect
        if ( this.visualState && this.opacity ){
            let gradient = ctx.createLinearGradient(rectPosX, rectPosY, rectPosX + rectWidth, rectPosY );
            gradient.addColorStop(0, this.gradientColorLimits);
            for( let i = 0; i < this.gradient.length; ++i){
                const g = this.gradient[i];
                gradient.addColorStop(g[0], this.gradientColor + "," + g[1] +")");
            }
            gradient.addColorStop(1,this.gradientColorLimits);
            ctx.fillStyle = gradient;
            ctx.globalAlpha = this.opacity;
    
            ctx.beginPath();
    
            ctx.moveTo(rectPosX, rectPosY + radiusTL);
            ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + radiusTL, rectPosY );
            ctx.lineTo( rectPosX + rectWidth - radiusTR, rectPosY );
            ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY + radiusTR );
            ctx.lineTo( rectPosX + rectWidth, rectPosY + rectHeight - radiusBR );
            ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - radiusBR, rectPosY + rectHeight );
            ctx.lineTo( rectPosX + radiusBL, rectPosY + rectHeight );
            ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - radiusBL );
    
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        
        // borders
        ctx.strokeStyle = this.borderColor;

        ctx.lineWidth = 4;

        ctx.beginPath();
        ctx.moveTo(rectPosX, rectPosY + radiusTL*0.5);
        ctx.quadraticCurveTo(rectPosX, rectPosY, rectPosX + radiusTL*0.5, rectPosY );
        ctx.moveTo( rectPosX + rectWidth - radiusTR*0.5, rectPosY );
        ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY, rectPosX + rectWidth, rectPosY + radiusTR*0.5 );
        ctx.moveTo( rectPosX + rectWidth, rectPosY + rectHeight - radiusBR*0.5 );
        ctx.quadraticCurveTo(rectPosX + rectWidth, rectPosY + rectHeight, rectPosX + rectWidth - radiusBR*0.5, rectPosY + rectHeight );
        ctx.moveTo( rectPosX + radiusBL*0.5, rectPosY + rectHeight );
        ctx.quadraticCurveTo(rectPosX, rectPosY + rectHeight, rectPosX, rectPosY + rectHeight - radiusBL*0.5 );
        ctx.stroke();
        ctx.lineWidth = 1.5;

        let lineSize = timeline.trackHeight;
        let remaining = rectHeight - timeline.trackHeight;
        let amount = 0;
        if (lineSize > 0){
            amount = Math.ceil(remaining/lineSize);
            lineSize = remaining / amount;
        }

        let start = rectPosY + timeline.trackHeight * 0.5;
        for( let i = 0; i < amount; ++i ){
            ctx.moveTo(rectPosX, start + lineSize * i + lineSize*0.3);
            ctx.lineTo(rectPosX, start + lineSize * i + lineSize*0.7);
            ctx.moveTo(rectPosX + rectWidth, start + lineSize * i + lineSize*0.3);
            ctx.lineTo(rectPosX + rectWidth, start + lineSize * i + lineSize*0.7);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        // end of borders
    }
}

Math.clamp = function (v, a, b) {
	return a > v ? a : b < v ? b : v;
};

export { VideoEditor, TimeBar }