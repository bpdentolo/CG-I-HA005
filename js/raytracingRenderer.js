function dataSetColor(self, x, y, color, alpha=1) {
    let index = x + y * self.width;
    self.data[index * 4] = color.r * 255;
    self.data[index * 4 + 1] = color.g * 255.0;
    self.data[index * 4 + 2] = color.b * 255.0;
    self.data[index * 4 + 3] = alpha * 255;
}

ImageData.prototype.setColor = function(x, y, color, alpha=1) {
    dataSetColor(this, x, y, color, alpha);
}

function dataReadColor(self, x, y, color) {
    let index = x + y * self.width;
    color.r = self.data[index * 4] / 255;
    color.g = self.data[index * 4 + 1] / 255.0;
    color.b = self.data[index * 4 + 2] / 255.0;
    return self.data[index * 4 + 3] / 255.0;
}

ImageData.prototype.readColor = function(x, y, color) {
    return dataReadColor(this, x, y, color);
}

function createImageData(width, height) {
    let data = [];
    for(var i = 0; i < width*height; i += 1) {
        data.push(0);
        data.push(0);
        data.push(0);
        data.push(0);
    }
    let obj = {
        width: width,
        height: height,
        data: data
    };
    Object.defineProperty(obj, 'setColor', {
        value: ImageData.prototype.setColor
    });
    Object.defineProperty(obj, 'readColor', {
        value: ImageData.prototype.readColor
    });
    return obj;
}

/**
 * RaytracingRenderer interpretation of http://github.com/zz85
 */

var RaytracingRenderer =function(scene, camera, workerObject)
{
    this.scene = scene;
    this.camera = camera;

    this.rendering = false;
    this.superSamplingRate = 0;
    this.maxRecursionDepth = 4;

    this.allLights = true;
    this.calcDiffuse = true;
    this.calcPhong = true;
    this.phongMagnitude = 50;
    this.useMirrors = true;

    this.workerObject = workerObject;
    this.isWorker = (workerObject != undefined);

    if (!this.isWorker) {
        this.canvas = document.createElement('canvas');
        window.canvas = this.canvas;
        this.context = this.canvas.getContext('2d', {
            alpha: false
        });

        this.createImageData = this.context.createImageData.bind(this.context);
    } else {
        this.createImageData = createImageData;
    }
    this.workerCount = 15;
    this.sectionWidth = 6;
    this.sectionSize = {x: 64, y: 64};

    this.overwriteSize = true;
    this.sizeOverwrite = {x: 960, y: 720};
    // this.sizeOverwrite = {x: 120, y: 120};

    this.clearColor = new THREE.Color(0x000000);
    this.domElement = this.canvas;
    this.autoClear = true;

    this.raycaster = new THREE.Raycaster();
    this.imageData = null;
    if (typeof Image != 'undefined') {
        this.image = new Image();
        this.image.onload = this.render.bind(this);
    }

    if (!this.isWorker) {
        this.clock = new THREE.Clock();
        this.workers = [];
        this.tmpColor = new THREE.Color(0, 0, 0);

        setInterval(this.updateWorkers.bind(this), 1000)
    }

    this.lights = [];
    for(var c = 0; c < this.scene.children.length; c++)
    {
        if(this.scene.children[c].isPointLight || this.scene.children[c].isSpotLight)
            this.lights.push(this.scene.children[c]);
    }
}

RaytracingRenderer.prototype.setClearColor = function ( color, alpha )
{
	clearColor.set( color );
};

RaytracingRenderer.prototype.clear = function () {	};

RaytracingRenderer.prototype.spawnWorker = function () {
    var worker = new Worker('js/worker.js');
    worker.addEventListener('message', this.workerMessageHandler.bind(this), false);
    this.workers.push(worker);
}

RaytracingRenderer.prototype.workerMessageHandler = function (e) {
    switch(e.data.message) {
        case 'raytraceResult':
            let sectionWidth = e.data.data.width;
            let sectionHeight = e.data.data.height;
            for(let y = 0; y < sectionHeight; y += 1) {
                for(let x = 0; x < sectionWidth; x += 1) {
                    dataReadColor(e.data.data,x, y, this.tmpColor);
                    this.imageData.setColor(x, y, this.tmpColor);
                }
            }
            this.context.putImageData(this.imageData, e.data.startX, e.data.startY);
            this.render();
            this.sectionCount.calculated += 1;
            if(this.sectionCount.calculated == this.sectionCount.total) {
                this.rendering = false;
                this.clock.stop();
                console.log("Finished rendering in " + this.clock.elapsedTime + " seconds. Image " + this.canvas.width + " w / " + this.canvas.height + " h");
            }
            break;
    }
}

RaytracingRenderer.prototype.render = function() {
    if(this.imageData != null) {
        let imageAspect = this.canvas.width/this.canvas.height;
        if(imageAspect < window.innerWidth/window.innerHeight) {
            let width = window.innerHeight * imageAspect;
            this.canvas.style.width = width + "px";
            this.canvas.style.height = '100%';
            this.canvas.style.left = (window.innerWidth - width) / 2 + 'px';
            this.canvas.style.top = '0px';
        } else {
            let height = window.innerWidth / imageAspect;
            this.canvas.style.width = '100%';
            this.canvas.style.height = height + "px";
            this.canvas.style.left = '0px';
            this.canvas.style.top = (window.innerHeight - height) / 2 + 'px';
        }
    }
}

RaytracingRenderer.prototype.saveImage = function(){
    this.canvas.toBlob(function(blob) {
        saveAs(blob, "img.png");
    }, "./");
};

RaytracingRenderer.prototype.updateWorkers = function () {
    this.workerCount = Math.max(Math.floor(this.workerCount), 1);
    while(this.workers.length < this.workerCount) {
        this.spawnWorker();
    }
    if(this.workers.length > this.workerCount) {
        for(let i = this.workerCount; i < this.workers.length; i += 1) {
            this.workers[i].postMessage({command: 'close'});
        }
        this.workers.splice(this.workerCount, this.workers.length - this.workerCount);
    }
}

RaytracingRenderer.prototype.raytrace = function () {

    if(!this.rendering) {
        let width;
        let height;
        if(this.isWorker || this.overwriteSize) {
            width = this.sizeOverwrite.x;
            height = this.sizeOverwrite.y;
        } else {
            width = window.innerWidth;
            height = window.innerHeight;
        }
        this.sectionCount = {};
        if(!this.isWorker) {
            this.sectionSize = {x:Math.pow(2,this.sectionWidth)};
            this.sectionSize.y = this.sectionSize.x;
        }
        this.sectionCount.x = Math.ceil(width / this.sectionSize.x);
        this.sectionCount.y = Math.ceil(width / this.sectionSize.y);
        this.sectionCount.total = this.sectionCount.x * this.sectionCount.y;
        this.sectionCount.calculated = 0;
        if(!this.isWorker) {
            this.imageData = this.createImageData(this.sectionSize.x, this.sectionSize.y);
            this.updateWorkers();
            this.clock.start();
            this.rendering = true;
            this.canvas.width = width;
            this.canvas.height = height;
            this.workerProgress = [];
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            for(let i = 0; i < this.workers.length; i += 1) {
                this.workerProgress.push(0);
                let worker = this.workers[i];
                worker.postMessage({
                    command:'raytrace',
                    size: {x: width, y: height},
                    superSamplingRate: this.superSamplingRate,
                    maxRecursionDepth: this.maxRecursionDepth,
                    phongMagnitude: this.phongMagnitude,
                    allLights: this.allLights,
                    calcDiffuse: this.calcDiffuse,
                    calcPhong: this.calcPhong,
                    useMirrors: this.useMirrors,
                    sectionSize: this.sectionSize,
                    workerIndex: i,
                    workerCount: this.workers.length
                });
            }
        }
        else {

            // update scene graph
            if (this.scene.autoUpdate === true) {
                this.scene.updateMatrixWorld();
            }

            // update camera matrices
            if (this.camera.parent === null) {
                this.camera.updateMatrixWorld();
            }

            this.camera.aspect = width/height;
            this.camera.updateProjectionMatrix();

            for(let i = this.workerIndex; i < this.sectionCount.total; i += this.workerCount) {
                let x = (i % this.sectionCount.x) * this.sectionSize.x;
                let y = Math.floor(i / this.sectionCount.x) * this.sectionSize.y;
                // this.fillImageWithNoisyStripes(x,y,this.sectionSize.x, this.sectionSize.y, width, height);
                this.raytraceSection(x,y,this.sectionSize.x, this.sectionSize.y, width, height);
            }

            this.rendering = false;
        }
    }
}


RaytracingRenderer.prototype.fillImageWithNoisyStripes = function(startX, startY, width, height, totalWidth, totalHeight) {
    //fill image with noise
    this.imageData = this.createImageData(width, height);

    for(let y = startY; y < startY + height; y += 1) {
        let c = new THREE.Color(Math.random(),Math.random(),Math.random());
        for(let x = startX; x < startX + width; x += 1) {
            this.imageData.setColor(x - startX, y - startY, c);
        }
    }

    if(!this.isWorker) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.context.putImageData(this.imageData, 0, 0);
        this.image.src = this.canvas.toDataURL();
    } else {
        this.workerObject.postMessage({
            message: 'raytraceResult',
            data: this.imageData,
            startX: startX,
            startY: startY,
        });
    }
};

RaytracingRenderer.prototype.raytraceSection = function (startX, startY, width, height, totalWidth, totalHeight) {
    this.imageData = this.createImageData(width, height);

    let defaultColor = new THREE.Color(0,0,0);
    let screenPos = new THREE.Vector2(0,0);
    let pixelColor = new THREE.Color(0,0,0);
    var recursionCounter = 1;

    for(let y = startY; y < startY + height; y += 1) {
        for(let x = startX; x < startX + width; x += 1) {
            pixelColor.setRGB(0.0,0.0,0.0);

            if(this.superSamplingRate < 1)
            {
                let castX = x  / totalWidth * 2 - 1;
                let castY = y / totalHeight * 2 - 1;
                this.renderPixel(pixelColor, recursionCounter, screenPos.set(castX, -castY), defaultColor);
            }
            else {
                // Todo: super-sampling
                if (this.superSamplingRate === 1) {
                    this.renderMSAAx1(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight);
                } else if (this.superSamplingRate === 2) {
                    this.renderMSAAx2(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight);
                } else if (this.superSamplingRate === 3) {
                    this.renderMSAAx3(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight);
                }

            }
            this.imageData.setColor(x - startX, y - startY, pixelColor);
        }
    }

    if(!this.isWorker) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.context.putImageData(this.imageData, 0, 0);
        this.image.src = this.canvas.toDataURL();
    } else {
        this.workerObject.postMessage({
            message: 'raytraceResult',
            data: this.imageData,
            startX: startX,
            startY: startY,
        });
    }
}

RaytracingRenderer.prototype.renderPixel = function(pixelColor, recursionCounter, pixPos, defaultColor) {
    let cameraPos = new THREE.Vector3();
    cameraPos.setFromMatrixPosition(this.camera.matrixWorld);

    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pixPos, this.camera);

    var intersects = raycaster.intersectObjects( this.scene.children );
    if (intersects.length !== 0) {
        var defaultPixelColor = intersects[0].object.material.color;
        if (this.calcDiffuse === false && this.calcPhong === false) {
            pixelColor.set(intersects[0].object.material.color);
        } else {
            var origin = intersects[0].point;
            var direction_and_normalWorld = this.calculateDirection(origin, cameraPos, intersects[0]);
            var direction = direction_and_normalWorld[0];
            var intersectionNormalWorld = direction_and_normalWorld[1];
            this.spawnRay(pixelColor, intersectionNormalWorld, recursionCounter, intersects[0], origin, direction, this.maxRecursionDepth, Infinity, defaultColor, defaultPixelColor);
            //CEILING COLOR VALUES
            var finalColor = this.getMaxNumber(pixelColor.r, pixelColor.g, pixelColor.b);
            pixelColor.r = finalColor[0];
            pixelColor.g = finalColor[1];
            pixelColor.b = finalColor[2];
            return true;
        }
    } else {
        pixelColor.set(defaultColor);
    }

}

RaytracingRenderer.prototype.calculateDirection = function(origin, cameraPos, intersection) {
    var pointToCameraVector = cameraPos.sub(origin).normalize();
    if (intersection.object.geometry.type === "SphereGeometry") {
        var sphereCenter = new THREE.Vector3();
        intersection.object.getWorldPosition(sphereCenter);
        var intersectionNormalWorld = origin.sub(sphereCenter).normalize();
    } else if (intersection.object.geometry.type === "BoxGeometry") {
        var intersectionNormal = intersection.face.normal;
        var normalMatrix = new THREE.Matrix3().getNormalMatrix( intersection.object.matrixWorld );
        var intersectionNormalWorld = intersectionNormal.clone().applyMatrix3( normalMatrix ).normalize();
    } else {
        console.log("Error, intersecting an object that's neither a sphere nor a box.");
    }
    var direction = intersectionNormalWorld.multiplyScalar(intersectionNormalWorld.dot(pointToCameraVector)).multiplyScalar(2.0);
    direction = direction.sub(pointToCameraVector).normalize();
    return [direction, intersectionNormalWorld];
}

RaytracingRenderer.prototype.getIntersection = function(origin, direction, farPlane) {
    // ToDo: return intersected object
    var raycaster = new THREE.Raycaster();
    raycaster.set(origin, direction);
    return raycaster.intersectObjects( this.scene.children );
}

//this method has most of the stuff of this exercise.
//good coding style will ease this exercise significantly.
RaytracingRenderer.prototype.spawnRay = function (pixelColor, intersectionNormal, recursionCounter, intersection, origin, direction, recursionDepth, farPlane, defaultColor, defaultPixelColor) {

    if (intersection.object.material.mirror === true && this.useMirrors === true && (this.calcDiffuse || this.calcPhong) === true) {
            if (recursionCounter <= this.maxRecursionDepth) {
                var raycaster = new THREE.Raycaster();
                raycaster.set(origin, direction);
                var intersects = raycaster.intersectObjects(this.scene.children);
                if (intersects.length !== 0) {
                    recursionCounter += 1;
                    var originRecursive = intersects[0].point;
                    var direction_and_normalWorld = this.calculateDirection(originRecursive, origin, intersects[0]);
                    var directionRecursive = direction_and_normalWorld[0];
                    var intersectionNormalWorldRecursive = direction_and_normalWorld[1];
                    var defaultPixelColorRecursive = intersects[0].object.material.color;
                    this.spawnRay(pixelColor,intersectionNormalWorldRecursive, recursionCounter, intersects[0], originRecursive, directionRecursive, recursionDepth, farPlane, defaultColor, defaultPixelColorRecursive);
                }
            }

    }

    var diffuseOne = 0.0;
    var phongOne = 0.0;
    var diffuseTwo = 0.0;
    var phongTwo = 0.0;
    var diffuseThree = 0.0;
    var phongThree = 0.0;
    var diffuseFour = 0.0;
    var phongFour = 0.0;

    var intersectsTowardsLightOne = this.intersectLightSource(origin, this.lights[0].matrixWorld);
    var intersectsTowardsLightTwo = this.intersectLightSource(origin, this.lights[1].matrixWorld);
    var intersectsTowardsLightThree = this.intersectLightSource(origin, this.lights[2].matrixWorld);
    var intersectsTowardsLightFour = this.intersectLightSource(origin, this.lights[3].matrixWorld);
    if (this.allLights === true) {
        if(intersectsTowardsLightOne.length === 0) {
            if (this.calcDiffuse === true) {
                //DIFFUSE
                diffuseOne = this.computeDiffuseLight(origin, intersectionNormal, this.lights[0].matrixWorld, this.lights[0]);
            }
            if (this.calcPhong === true) {
                //PHONG
                phongOne = this.computePhongLight(origin, direction, pixelColor, this.lights[0].matrixWorld, intersection.object.material.shininess, this.lights[0]);
            }
        }
        if(intersectsTowardsLightTwo.length === 0) {
            if (this.calcDiffuse === true) {
                //DIFFUSE
                diffuseTwo = this.computeDiffuseLight(origin, intersectionNormal, this.lights[1].matrixWorld, this.lights[1]);
            }
            if (this.calcPhong === true) {
                //PHONG
                phongTwo = this.computePhongLight(origin, direction, pixelColor, this.lights[1].matrixWorld, intersection.object.material.shininess, this.lights[1]);
            }
        }
        if(intersectsTowardsLightThree.length === 0) {
            if (this.calcDiffuse === true) {
                //DIFFUSE
                diffuseThree = this.computeDiffuseLight(origin, intersectionNormal, this.lights[2].matrixWorld, this.lights[2]);
            }
            if (this.calcPhong === true) {
                //PHONG
                phongThree = this.computePhongLight(origin, direction, pixelColor, this.lights[2].matrixWorld, intersection.object.material.shininess, this.lights[2]);
            }
        }
        if(intersectsTowardsLightFour.length === 0) {
            if (this.calcDiffuse === true) {
                //DIFFUSE
                diffuseFour = this.computeDiffuseLight(origin, intersectionNormal, this.lights[3].matrixWorld, this.lights[3]);
            }
            if (this.calcPhong === true) {
                //PHONG
                phongFour = this.computePhongLight(origin, direction, pixelColor, this.lights[3].matrixWorld, intersection.object.material.shininess, this.lights[3]);
            }
        }
        if (intersectsTowardsLightOne.length === 0 || intersectsTowardsLightTwo.length === 0 || intersectsTowardsLightThree.length === 0 || intersectsTowardsLightFour.length === 0) {
            var tempRGB = this.combineDiffuseIntensities(pixelColor, defaultPixelColor, diffuseOne, diffuseTwo, diffuseThree, diffuseFour);
            this.combinePhongIntensities(pixelColor, tempRGB, phongOne, phongTwo, phongThree, phongFour, recursionCounter);
            return true;
        } else {
            pixelColor.set(defaultColor);
            return false;
        }
    } else {
        if(intersectsTowardsLightOne.length === 0) {
            var tempR = 0.0;
            var tempG = 0.0;
            var tempB = 0.0;
            if (this.calcDiffuse === true) {
                //DIFFUSE
                diffuseOne = this.computeDiffuseLight(origin, intersectionNormal, this.lights[0].matrixWorld, this.lights[0]);

                tempR = (defaultPixelColor.r * diffuseOne);
                tempG = (defaultPixelColor.g * diffuseOne);
                tempB = (defaultPixelColor.b * diffuseOne);
            }
            if (this.calcPhong === true) {
                //PHONG
                phongOne = this.computePhongLight(origin, direction, pixelColor, this.lights[0].matrixWorld, intersection.object.material.shininess, this.lights[0]);
                tempR += (1.0 * phongOne);
                tempG += (0.9 * phongOne);
                tempB += (0.1 * phongOne);
            }

            //AVERAGE COLOR INCREMENT
            pixelColor.r += tempR / recursionCounter;
            pixelColor.g += tempG / recursionCounter;
            pixelColor.b += tempB / recursionCounter;
            return true;
        } else {
            pixelColor.set(defaultColor);
            return false;
        }
    }
};

RaytracingRenderer.prototype.computeLightDirection = function(origin, lightSource) {
    var lightSourcePosition = new THREE.Vector3();
    lightSourcePosition.setFromMatrixPosition(lightSource);
    return lightSourcePosition.sub(origin).normalize();
}

RaytracingRenderer.prototype.intersectLightSource = function(origin, lightSource) {
    var lightDirection = this.computeLightDirection(origin, lightSource);
    var lightRaycaster = new THREE.Raycaster();
    lightRaycaster.set(origin, lightDirection);
    return lightRaycaster.intersectObjects( this.scene.children );
}

RaytracingRenderer.prototype.computeLightAttenuation = function(origin, lightSource) {
    var lightSourceWorldCoordinates = new THREE.Vector3();
    lightSourceWorldCoordinates.setFromMatrixPosition(lightSource);
    var originToLightDistance = new THREE.Vector3();
    originToLightDistance.copy(lightSourceWorldCoordinates.sub(origin));
    var lightAttenuationFactor = 1/Math.pow(originToLightDistance.length(), 2);
    return lightAttenuationFactor;
}

RaytracingRenderer.prototype.computeDiffuseLight = function(origin, intersectionNormal, lightSource, lightObject) {
    var lightDirection = this.computeLightDirection(origin, lightSource);
    var attenuationFactor = this.computeLightAttenuation(origin, lightSource);
    return (attenuationFactor * lightObject.intensity * (((0.95 * (intersectionNormal.dot(lightDirection))) + 1) / 2));
}

RaytracingRenderer.prototype.computePhongLight = function(origin, direction, pixelColor, lightSource, shininess, lightObject) {
    var lightDirection = this.computeLightDirection(origin, lightSource);
    var r_s = 0.4 * Math.pow(direction.dot(lightDirection), shininess);
    if ( direction.dot(lightDirection) > 0 ) {
        var L_spec = this.phongMagnitude * r_s * 0.39 * ( ( (Math.pow(direction.dot(lightDirection), shininess)) + 1) / 2);
    } else {
        var L_spec = 0;
    }
    var attenuationFactor = this.computeLightAttenuation(origin, lightSource);
    return (attenuationFactor * lightObject.intensity * L_spec);
}

RaytracingRenderer.prototype.combineDiffuseIntensities = function(pixelColor, defaultPixelColor, intensityOne, intensityTwo, intensityThree, intensityFour) {
    var finalIntensity = (intensityOne + intensityTwo + intensityThree + intensityFour) / 4;
    var tempR = (defaultPixelColor.r * finalIntensity);
    var tempG = (defaultPixelColor.g * finalIntensity);
    var tempB = (defaultPixelColor.b * finalIntensity);
    return [tempR, tempG, tempB];
}

RaytracingRenderer.prototype.combinePhongIntensities = function(pixelColor, tempRGB, intensityOne, intensityTwo, intensityThree, intensityFour, recursionCounter) {
    var finalIntensity_r = (1.0 * intensityOne) + (1.0 * intensityTwo) + (1.0 * intensityThree) + (1.0 * intensityFour);
    var finalIntensity_g = (1.0 * intensityOne) + (0.9 * intensityTwo) + (0.9 * intensityThree) + (1.0 * intensityFour);
    var finalIntensity_b = (1.0 * intensityOne) + (0.1 * intensityTwo) + (0.1 * intensityThree) + (1.0 * intensityFour);
    tempRGB[0] += finalIntensity_r;
    tempRGB[1] += finalIntensity_g;
    tempRGB[2] += finalIntensity_b;

    pixelColor.r += tempRGB[0] / recursionCounter;
    pixelColor.g += tempRGB[1] / recursionCounter;
    pixelColor.b += tempRGB[2] / recursionCounter;
    return true;
}

RaytracingRenderer.prototype.getMaxNumber = function(numberOne, numberTwo, numberThree) {
    var temp = Math.max(numberOne, numberTwo);
    var maxNumber = Math.max(temp, numberThree);
    if (maxNumber > 1.0) {
        numberOne = numberOne / maxNumber;
        numberTwo = numberTwo / maxNumber;
        numberThree = numberThree / maxNumber;
    }
    return [numberOne, numberTwo, numberThree];
}

RaytracingRenderer.prototype.renderMSAAx1 = function(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight) {
    let castXone = (2 * x / (totalWidth * 2)) * 2 - 1;
    let castYone = (2 * y / (totalHeight * 2)) * 2 - 1;
    let msaaColorOne = new THREE.Color(0,0,0);
    msaaColorOne.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorOne, recursionCounter, screenPos.set(castXone, -castYone), defaultColor);

    let castXtwo = ((2 * x + 1) / (totalWidth *2)) * 2 - 1;
    let castYtwo = ((2 * y + 1) / (totalHeight *2)) * 2 - 1;
    let msaaColorTwo = new THREE.Color(0,0,0);
    msaaColorTwo.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorTwo, recursionCounter, screenPos.set(castXtwo, -castYtwo), defaultColor);

    var finalMSAAColor = [(msaaColorOne.r + msaaColorTwo.r) / 2, (msaaColorOne.g + msaaColorTwo.g) / 2, (msaaColorOne.b + msaaColorTwo.b) / 2];
    pixelColor.r = finalMSAAColor[0];
    pixelColor.g = finalMSAAColor[1];
    pixelColor.b = finalMSAAColor[2];
    return true;
}

RaytracingRenderer.prototype.renderMSAAx2 = function(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight) {
    let castXone = (3 * x / (totalWidth * 3)) * 2 - 1;
    let castYone = (3 * y / (totalHeight * 3)) * 2 - 1;
    let msaaColorOne = new THREE.Color(0,0,0);
    msaaColorOne.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorOne, recursionCounter, screenPos.set(castXone, -castYone), defaultColor);

    let castXtwo = ((3 * x + 1) / (totalWidth *3)) * 2 - 1;
    let castYtwo = ((3 * y + 1) / (totalHeight *3)) * 2 - 1;
    let msaaColorTwo = new THREE.Color(0,0,0);
    msaaColorTwo.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorTwo, recursionCounter, screenPos.set(castXtwo, -castYtwo), defaultColor);

    let castXThree = ((3 * x + 2) / (totalWidth *3)) * 2 - 1;
    let castYThree = ((3 * y + 2) / (totalHeight *3)) * 2 - 1;
    let msaaColorThree = new THREE.Color(0,0,0);
    msaaColorThree.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorThree, recursionCounter, screenPos.set(castXThree, -castYThree), defaultColor);

    var finalMSAAColor = [(msaaColorOne.r + msaaColorTwo.r + msaaColorThree.r) / 3, (msaaColorOne.g + msaaColorTwo.g + msaaColorThree.g) / 3, (msaaColorOne.b + msaaColorTwo.b + msaaColorThree.b) / 3];
    pixelColor.r = finalMSAAColor[0];
    pixelColor.g = finalMSAAColor[1];
    pixelColor.b = finalMSAAColor[2];
    return true;
}

RaytracingRenderer.prototype.renderMSAAx3 = function(x, y, pixelColor, recursionCounter, screenPos, defaultColor, totalWidth, totalHeight) {
    let castXone = (4 * x / (totalWidth * 4)) * 2 - 1;
    let castYone = (4 * y / (totalHeight * 4)) * 2 - 1;
    let msaaColorOne = new THREE.Color(0,0,0);
    msaaColorOne.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorOne, recursionCounter, screenPos.set(castXone, -castYone), defaultColor);

    let castXtwo = ((4 * x + 1) / (totalWidth *4)) * 2 - 1;
    let castYtwo = ((4 * y + 1) / (totalHeight *4)) * 2 - 1;
    let msaaColorTwo = new THREE.Color(0,0,0);
    msaaColorTwo.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorTwo, recursionCounter, screenPos.set(castXtwo, -castYtwo), defaultColor);

    let castXThree = ((4 * x + 2) / (totalWidth *4)) * 2 - 1;
    let castYThree = ((4 * y + 2) / (totalHeight *4)) * 2 - 1;
    let msaaColorThree = new THREE.Color(0,0,0);
    msaaColorThree.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorThree, recursionCounter, screenPos.set(castXThree, -castYThree), defaultColor);

    let castXFour = ((4 * x + 3) / (totalWidth *4)) * 2 - 1;
    let castYFour = ((4 * y + 3) / (totalHeight *4)) * 2 - 1;
    let msaaColorFour = new THREE.Color(0,0,0);
    msaaColorFour.setRGB(0.0,0.0,0.0);
    this.renderPixel(msaaColorFour, recursionCounter, screenPos.set(castXFour, -castYFour), defaultColor);

    var finalMSAAColor = [(msaaColorOne.r + msaaColorTwo.r + msaaColorThree.r + msaaColorFour.r) / 4, (msaaColorOne.g + msaaColorTwo.g + msaaColorThree.g + msaaColorFour.g) / 4, (msaaColorOne.b + msaaColorTwo.b + msaaColorThree.b + msaaColorFour.b) / 4];
    pixelColor.r = finalMSAAColor[0];
    pixelColor.g = finalMSAAColor[1];
    pixelColor.b = finalMSAAColor[2];
}