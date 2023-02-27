import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { HolloEffect } from './holloEffect.js'

// Debug
const gui = new dat.GUI({
    width: 270
})

// Instantiate a loader
const loader = new GLTFLoader();

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()

// Objects
const geometry = new THREE.TorusGeometry(.7, .2, 16, 100);

// Materials

const material = new THREE.MeshStandardMaterial()
// material.color = new THREE.Color(0x000000)
// material.wireframe = true


// Mesh
const sphere = new THREE.Mesh(geometry, material)
// scene.add(sphere)

// Lights

const pointLight = new THREE.AmbientLight(0xffffff, 1)
pointLight.position.x = 2
pointLight.position.y = 3
pointLight.position.z = 4
// scene.add(pointLight)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () => {
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 1000)
camera.position.set(0, 0, 6)
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x050505, 1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.8



const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

const customUniforms = {
    uTime: { value: 0.0 },
    uSpeed: { value: 2.0 }
}
/**
 * Env map lighting effect
 */
const lighting = new THREE.TextureLoader().load(
    'grad.jpg',
    (texture) => {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture

        // scene.background = envMap
        scene.environment = envMap

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = customUniforms.uTime
            shader.uniforms.uSpeed = customUniforms.uSpeed

            shader.fragmentShader = `
                uniform float uTime;
                uniform float uSpeed;
                mat4 rotationMatrix(vec3 axis, float angle) {
                    axis = normalize(axis);
                    float s = sin(angle);
                    float c = cos(angle);
                    float oc = 1.0 - c;
                  
                    return mat4(
                      oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                      oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                      oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                      0.0,                                0.0,                                0.0,                                1.0
                    );
                  }
        
                  vec3 rotate(vec3 v, vec3 axis, float angle){
                    mat4 m = rotationMatrix(axis, angle);
                    return (m * vec4(v, 1.0)).xyz;
                  }
                  
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <envmap_physical_pars_fragment>`,

                `  
                #if defined( USE_ENVMAP )

                #ifdef ENVMAP_MODE_REFRACTION
                    uniform float refractionRatio;
                #endif

                vec3 getLightProbeIndirectIrradiance( /*const in SpecularLightProbe specularLightProbe,*/ const in GeometricContext geometry, const in int maxMIPLevel ) {

                    vec3 worldNormal = inverseTransformDirection( geometry.normal, viewMatrix );

                    #ifdef ENVMAP_TYPE_CUBE

                        vec3 queryVec = vec3( flipEnvMap * worldNormal.x, worldNormal.yz );

                        // TODO: replace with properly filtered cubemaps and access the irradiance LOD level, be it the last LOD level
                        // of a specular cubemap, or just the default level of a specially created irradiance cubemap.

                        #ifdef TEXTURE_LOD_EXT

                            vec4 envMapColor = textureCubeLodEXT( envMap, queryVec, float( maxMIPLevel ) );

                        #else

                            // force the bias high to get the last LOD level as it is the most blurred.
                            vec4 envMapColor = textureCube( envMap, queryVec, float( maxMIPLevel ) );

                        #endif

                        envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;

                    #elif defined( ENVMAP_TYPE_CUBE_UV )

                        vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );

                    #else

                        vec4 envMapColor = vec4( 0.0 );

                    #endif

                    return PI * envMapColor.rgb * envMapIntensity;

                }

                // Trowbridge-Reitz distribution to Mip level, following the logic of http://casual-effects.blogspot.ca/2011/08/plausible-environment-lighting-in-two.html
                float getSpecularMIPLevel( const in float roughness, const in int maxMIPLevel ) {

                    float maxMIPLevelScalar = float( maxMIPLevel );

                    float sigma = PI * roughness * roughness / ( 1.0 + roughness );
                    float desiredMIPLevel = maxMIPLevelScalar + log2( sigma );

                    // clamp to allowable LOD ranges.
                    return clamp( desiredMIPLevel, 0.0, maxMIPLevelScalar );

                }

                vec3 getLightProbeIndirectRadiance( /*const in SpecularLightProbe specularLightProbe,*/ const in vec3 viewDir, const in vec3 normal, const in float roughness, const in int maxMIPLevel ) {

                    #ifdef ENVMAP_MODE_REFLECTION

                        vec3 reflectVec = reflect( -viewDir, normal );

                        // Mixing the reflection with the normal is more accurate and keeps rough objects from gathering light from behind their tangent plane.
                        reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );

                    #else

                        vec3 reflectVec = refract( -viewDir, normal, refractionRatio );

                    #endif

                    reflectVec = inverseTransformDirection( reflectVec, viewMatrix );


                    // vec3(x, y, z) change to change direction of moving normals  change 0.3 to change speed of rotation like 2. or 22. ur wish
                    reflectVec = rotate(reflectVec, vec3(1.0, 0.0, 0.0), uTime * uSpeed);




                    float specularMIPLevel = getSpecularMIPLevel( roughness, maxMIPLevel );

                    #ifdef ENVMAP_TYPE_CUBE

                        vec3 queryReflectVec = vec3( flipEnvMap * reflectVec.x, reflectVec.yz );

                        #ifdef TEXTURE_LOD_EXT

                            vec4 envMapColor = textureCubeLodEXT( envMap, queryReflectVec, specularMIPLevel );

                        #else

                            vec4 envMapColor = textureCube( envMap, queryReflectVec, specularMIPLevel );

                        #endif

                        envMapColor.rgb = envMapTexelToLinear( envMapColor ).rgb;

                    #elif defined( ENVMAP_TYPE_CUBE_UV )

                        vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );

                    #endif

                    return envMapColor.rgb * envMapIntensity;

                }

                #endif
                `
            )

            material.userData.shader = shader
        }

        // sphere.material = material
        texture.dispose()
        pmremGenerator.dispose()

    }
)
/**============================================================================================================ */


 let mixer = null   
loader.load(
    'human-nocompress.glb',
    (gltf) =>
    {
        gltf.scene.traverse((child) =>
        {
            child.material = material
            // child.material.wireframe = true

            // mixer = new THREE.AnimationMixer(gltf.scene)
            // const action = mixer.clipAction(gltf.animations[1])
            // action.play()
        })
        scene.add(gltf.scene)
        gltf.scene.position.set(0,-2,0)
        gltf.scene.scale.set(0.3,0.3,0.3)
        gltf.scene = geometry.center()
    }
)


material.metalness = 1
material.roughness = 0.28

let obj = {
    exposure: 2,
    progress: 0,
    HoloIntensity: {value:0.5}
}

gui.add(material, 'metalness').min(0).max(1).step(0.0001).name('Material metalness')
gui.add(material, 'roughness').min(0).max(1).step(0.0001).name('Material roughness')

gui.add(obj, 'exposure').min(0).max(3).step(0.001).name('Material exposure').onChange(() => {
    renderer.toneMappingExposure = obj.exposure
})

gui.add(obj, 'progress').min(0).max(3).step(0.0001).name('state changer').onChange(() => {
    effect.uniforms.progress.value = obj.progress
})

gui.add(customUniforms.uSpeed, 'value').min(0.0).max(50.0).step(0.0001).name('speed changer')

gui.add(obj.HoloIntensity, 'value').min(0.0).max(40.0).step(0.0001).name('Holo Intensity changer').onChange(() => {
    effect.uniforms.uHoloIntensity.value = obj.HoloIntensity.value
})


// sphere.rotation.y = Math.PI/2

// Bloom default settings
const params = {
    exposure: 0.75,
    bloomThreshold: 0.05,
    bloomStrength: 1,
    bloomRadius: 0.8
};

const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.exposure = params.exposure;
bloomPass.threshold = params.bloomThreshold;
bloomPass.strength = params.bloomStrength;
bloomPass.radius = params.bloomRadius;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);


/**
 *  Gui Controls
 */
gui.add(params, 'exposure', 0.1, 2).step(0.0001).name('Bloom exposure').onChange(function (value) {

    renderer.toneMappingExposure = Math.pow(value, 4.0);

});

gui.add(params, 'bloomThreshold', 0.0, 1.0).step(0.0001).onChange(function (value) {

    bloomPass.threshold = Number(value);

});

gui.add(params, 'bloomStrength', 0.0, 3.0).step(0.0001).onChange(function (value) {

    bloomPass.strength = Number(value);

});

gui.add(params, 'bloomRadius', 0.0, 1.0).step(0.001).onChange(function (value) {

    bloomPass.radius = Number(value);

});


// Holographic Effect
const effect = new ShaderPass(HolloEffect)
composer.addPass(effect)

/**
 * Animate
 */
let previousTime = 0
const clock = new THREE.Clock()

const tick = () => {

    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime
    // Update objects
    // sphere.rotation.y = .5 * elapsedTime

    // update materials
    if (sphere) {
        if (material.userData) {
            customUniforms.uTime.value = elapsedTime
            effect.uniforms.uTime.value = elapsedTime
        }
    }
    if(mixer !== null){

        mixer.update(deltaTime)
    }
    // Update Orbital Controls
    controls.update(elapsedTime)

    // Render
    renderer.render(scene, camera)
    composer.render();

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()