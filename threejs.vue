<template>
  <div
    ref="rendererContainer"
    style="width: 100%; height: 100%"
  ></div>
  <!-- 悬浮弹窗元素 -->
  <div
    ref="tooltip"
    class="tooltip"
    v-show="isTooltipVisible"
    :style="tooltipStyle"
  >
    {{ selectedProvinceName }}
  </div>
  <!-- 点击弹窗 -->
  <div
    ref="clickTooltip"
    class="tooltip click-tooltip"
    v-show="isClickTooltipVisible"
    :style="clickTooltipStyle"
  >
    {{ clickProvinceName }}
  </div>
</template>
<script lang="ts" setup>
import * as THREE from 'three';
import * as d3 from 'd3';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { ref, onMounted, onBeforeUnmount, Ref } from 'vue';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as TWEEN from '@tweenjs/tween.js';
import loadMap from '@/map/threejs/loadMap';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
// 悬浮弹窗相关状态
const isTooltipVisible = ref(false);
const tooltipStyle = ref({ left: '0px', top: '0px' });
const selectedProvinceName = ref('');
const tooltip = ref(null);
// 点击弹窗相关状态
const isClickTooltipVisible = ref(false);
const clickTooltipStyle = ref({ left: '0px', top: '0px' });
const clickProvinceName = ref('');
const controls = ref<any>(null);
// 控制器，用于控制threejs相机相应鼠标事件
const rendererContainer = ref<HTMLDivElement | null>(null); // 用于渲染threejs的容器
const renderer = ref<THREE.WebGLRenderer | null>(null);
let composer: EffectComposer;
let finalComposer: EffectComposer;
const scene = new THREE.Scene(); // 场景，用于存放所有的对象
const camera = new THREE.PerspectiveCamera( // 相机，用于观察场景
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);
const mapGroup = new THREE.Group(); // 用于存放地图数据的组
let csm: CSM | null; // 用于存储 CSM 实例

const raycaster = new THREE.Raycaster(); // 射线caster，用于检测鼠标位置上的物体
const mouseMovePos = new THREE.Vector2(); // 鼠标位置向量，用于存储鼠标悬浮位置
const mouseClickPos = new THREE.Vector2(); // 用于存储鼠标点击位置
let hoveredProvince: THREE.Object3D | null = null; // 当前悬浮的省份
let selectedProvince: THREE.Object3D | null = null; // 当前点击选中的省份
let bloomLayer: THREE.Layers;
let materials = {};
const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
const params = {
  threshold: 1,
  strength: 1, // 强度
  radius: 0.84, // 半径
  exposure: 1.55 // 扩散
};
const projection = d3
  .geoMercator()
  .center([104.0, 37.5])
  .scale(80)
  .translate([0, 0]);
// 初始化 CSS2DRenderer
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none'; // 避免拦截鼠标事件
document.body.appendChild(labelRenderer.domElement);
let cones: any[] = [];
const speed = 0.04;

const loadGeoJson = async () => {
  const response = await fetch('/map_data/china.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch GeoJSON: ${response.status}`);
  }
  return await response.json();
};
// 初始化 Three.js 渲染器
const initThree = () => {
  renderer.value = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.value.shadowMap.enabled = false;
  renderer.value.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.value.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.value.toneMappingExposure = 1.25;

  (renderer.value as any).outputEncoding = THREE.sRGBEncoding;
  renderer.value.setPixelRatio(window.devicePixelRatio);
  renderer.value.setClearColor(0x000000, 1);
  renderer.value.setSize(window.innerWidth, window.innerHeight);
  rendererContainer.value!.appendChild(renderer.value.domElement);

  camera.position.set(0, -60, 120);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  controls.value = new OrbitControls(camera, renderer.value.domElement);
  controls.value.enableDamping = true; // 启用阻尼效果
  controls.value.dampingFactor = 0.1; // 阻尼系数
  controls.value.enableZoom = true; // 启用缩放
  controls.value.zoomSpeed = 0.5; // 缩放速度

  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(20, -50, 20);
  light.castShadow = true;
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  const ambientLight = new THREE.AmbientLight(0x404040, 1); // 半亮度的环境光
  // scene.background = new THREE.Color(0xa0d8ff);
  scene.add(light);
  scene.add(mapGroup);
  scene.add(ambientLight);

  csm = new CSM({
    maxFar: 5000,
    cascades: 4,
    mode: 'practical',
    parent: scene,
    shadowMapSize: 1024,
    lightDirection: new THREE.Vector3(1, -1, 1).normalize(),
    camera: camera
  });
  composer = new EffectComposer(renderer.value);
  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.0,
    0.4,
    0.8
  );
  bloomPass.threshold = params.threshold;
  bloomPass.strength = params.strength;
  bloomPass.radius = params.radius;
  composer.renderToScreen = false;
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  finalComposer = new EffectComposer(renderer.value);
  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: composer.renderTarget2.texture }
      },
      vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;

      void main() {
          vec4 baseColor = texture2D(baseTexture, vUv); // 普通物体的颜色
          vec4 bloomColor = texture2D(bloomTexture, vUv); // 发光图层的颜色

          // 如果发光颜色接近黑色（无发光），则仅显示基础颜色
          vec4 finalColor = baseColor + vec4(vec3(bloomColor.rgb), 0.0);
          gl_FragColor = finalColor;
      }
    `
    }),
    'baseTexture'
  );
  mixPass.needsSwap = true;
  finalComposer.addPass(renderScene);
  finalComposer.addPass(mixPass);
  const gui = new GUI();
  const bloomFolder = gui.addFolder('bloom');

  bloomFolder.add(params, 'threshold', 0.0, 1.0).onChange(function (value) {
    bloomPass.threshold = Number(value);
    render();
  });

  bloomFolder.add(params, 'strength', 0.0, 3).onChange(function (value) {
    bloomPass.strength = Number(value);
    render();
  });

  bloomFolder
    .add(params, 'radius', 0.0, 1.0)
    .step(0.01)
    .onChange(function (value) {
      bloomPass.radius = Number(value);
      render();
    });

  const toneMappingFolder = gui.addFolder('tone mapping');

  toneMappingFolder.add(params, 'exposure', 0.1, 2).onChange(function (value) {
    renderer.value!.toneMappingExposure = Math.pow(value, 4.0); // 调整画面曝光度
    render(); //    重新渲染画面
  });
  animate();
};

// 初始化地图数据
// const initMap = (chinaJson) => {
//   chinaJson.features.forEach((elem, index) => {
//     const province = new THREE.Object3D();
//     const { coordinates } = elem.geometry;
//     const color = new THREE.Color(COLOR_ARR[index % COLOR_ARR.length]);
//     province.userData = {
//       name: elem.properties.name, // 假设 JSON 中有 `properties` 和 `name` 字段
//       center: elem.properties.center, // 假设 JSON 中有 `center` 字段
//       originalPosition: province.position.clone() // 存储原始位置
//     };

//     const processPolygon = (polygon) => {
//       const shape = new THREE.Shape();
//       polygon.forEach(([x, y], i) => {
//         const [projX, projY] = projection([x, y]); // 自定义的投影函数
//         i === 0 ? shape.moveTo(projX, -projY) : shape.lineTo(projX, -projY);
//       });

//       const extrudeSettings = {
//         depth: 4,
//         bevelEnabled: true,
//         bevelSegments: 1,
//         bevelThickness: 0.2
//       };
//       const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

//       const material = new THREE.MeshPhongMaterial({
//         // metalness: 1,
//         color: color
//       });
//       const material1 = new THREE.MeshStandardMaterial({
//         metalness: 1,
//         roughness: 1,
//         color
//       });

//       const mesh = new THREE.Mesh(geometry, [material, material1]);
//       if (index % 2 === 0) mesh.scale.set(1, 1, 1.2);

//       mesh.castShadow = true;
//       mesh.receiveShadow = true;
//       mesh._color = color;
//       province.add(mesh);
//     };

//     const processCoordinates = (coords) => {
//       if (Array.isArray(coords[0][0])) {
//         // 如果第一个元素仍然是数组，递归处理
//         coords.forEach((subCoords) => processCoordinates(subCoords));
//       } else {
//         // 到达实际的多边形坐标
//         processPolygon(coords);
//       }
//     };

//     coordinates.forEach((multiPolygon) => {
//       processCoordinates(multiPolygon);
//     });
//     province.userData.originalPosition = province.position.clone(); // 存储原始位置
//     province.traverse((child) => {
//       if (child.isMesh) {
//         // 存储原始材质，仅存储一次
//         if (!child.userData.originalMaterial) {
//           child.userData.originalMaterial = child.material; // 使用 clone 来确保材质正确独立保存
//         }
//       }
//     });
//     mapGroup.add(province);
//   });
//   scene.add(mapGroup);
//   const posList = [
//     [116.405285, 39.904989], // 北京的经纬度
//     [121.473701, 31.230416] // 上海的经纬度
//   ];
//   const posList1 = [
//     [108.5545, 34.1524], // 西安的经纬度
//     [117.0052, 36.430416] // 济南的经纬度
//   ];

//   // addLine(posList, 'rgb(255 ,99, 71)');
//   // addLine(posList1, 'rgb(255, 215, 0)');
//   // // 调用广告牌函数
//   // addALabel({
//   //   color: 'rgb(255 ,99, 71)',
//   //   bg: 'rgba(255 ,99, 71, 0.3)',
//   //   pos: [116.405285, 39.904989], // 北京的位置
//   //   name: '北京市'
//   // });
//   // addALabel({
//   //   color: 'rgb(255, 215, 0)',
//   //   bg: 'rgba(255, 215,0, 0.3)',
//   //   pos: [108.5545, 34.1524], // 北京的位置
//   //   name: '西安市'
//   // });
// };
// 鼠标移动事件处理
const onMouseMove = (event) => {
  mouseMovePos.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseMovePos.y = -(event.clientY / window.innerHeight) * 2 + 1;
};
// 点击事件处理
const onClick = (event) => {
  mouseClickPos.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseClickPos.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouseClickPos, camera);
  const intersects = raycaster.intersectObjects(mapGroup.children, true);

  if (intersects.length > 0) {
    const clickedProvince = intersects[0].object.parent;

    if (selectedProvince !== clickedProvince) {
      if (selectedProvince) {
        resetProvince(selectedProvince, true);
        console.log(
          '上次点击已恢复，恢复省份为',
          selectedProvince.userData.name
        );
      } // 重置上一次点击的省份
      highlightProvince(clickedProvince, false); // 固定高亮
      selectedProvince = clickedProvince;
    }
  } else {
    // 点击空白区域时不进行操作
  }
};
// 键盘事件处理函数
const onKeyDown = (event) => {
  if (event.key === 'Escape' || event.key === 'Esc') {
    if (selectedProvince) {
      resetProvince(selectedProvince, true); // 恢复选中省份的样式
      selectedProvince = null; // 重置选中状态
      isClickTooltipVisible.value = false; // 关闭点击弹窗
      console.log('按下Esc键，选中状态已恢复');
    }
  }
};
// 动画循环
const animate = () => {
  requestAnimationFrame(animate);
  // 清除深度缓冲区，确保正确的深度测试
  controls.value.update();
  camera.updateMatrixWorld();
  csm!.update();
  // TWEEN 动画更新
  TWEEN.update();
  cone_animate();
  // 射线检测
  raycaster.setFromCamera(mouseMovePos, camera);
  const intersects = raycaster.intersectObjects(mapGroup.children, true);
  if (intersects.length > 0) {
    const intersectedProvince = intersects[0].object.parent;
    if (
      hoveredProvince !== intersectedProvince &&
      intersectedProvince !== selectedProvince
    ) {
      if (hoveredProvince) {
        resetProvince(hoveredProvince); // 恢复之前的省份
      }
      highlightProvince(intersectedProvince, true); // 高亮当前的省份
      hoveredProvince = intersectedProvince;
    }
  } else if (hoveredProvince && hoveredProvince !== selectedProvince) {
    resetProvince(hoveredProvince); // 恢复之前的省份
    hoveredProvince = null;
  }

  // 如果有选中的省份，实时更新点击弹窗的位置
  if (selectedProvince) {
    const box = new THREE.Box3().setFromObject(selectedProvince);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // 将中心位置投影到屏幕坐标系
    const vector = center.clone().project(camera);
    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;

    // 更新点击弹窗的位置
    clickTooltipStyle.value = {
      left: `${vector.x * halfWidth + halfWidth}px`,
      top: `${-vector.y * halfHeight + halfHeight}px`
    };
  }
  render();
  // 渲染场景
  // renderer.value!.render(scene, camera);
};
// 高亮省份
const highlightProvince = (province, isHover = false) => {
  if (isHover) {
    // 悬浮逻辑
    selectedProvinceName.value = province.userData.name || '未知省份';
    isTooltipVisible.value = true;

    const box = new THREE.Box3().setFromObject(province);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const vector = center.clone().project(camera);

    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;
    tooltipStyle.value = {
      left: `${vector.x * halfWidth + halfWidth}px`,
      top: `${-vector.y * halfHeight + halfHeight}px`
    };
  } else {
    // 点击逻辑
    clickProvinceName.value = province.userData.name || '未知省份';
    isClickTooltipVisible.value = true;
    if (isTooltipVisible.value) isTooltipVisible.value = false;
    const box = new THREE.Box3().setFromObject(province);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const vector = center.clone().project(camera);

    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;
    clickTooltipStyle.value = {
      left: `${vector.x * halfWidth + halfWidth}px`,
      top: `${-vector.y * halfHeight + halfHeight}px`
    };
  }
  //  位置上移并高亮
  province.position.z += 4;
  province.traverse((child) => {
    if (child.isMesh) {
      // if (!child.userData.originalColor) {
      //   child.userData.originalMaterial = child.material; // 保存原材质
      // }
      // child.layers.enable(1); // 启用渲染该材质的图层
      const originalColor = isHover
        ? child.userData.originalColor || new THREE.Color(0xde0011)
        : new THREE.Color(0x007acc); // 获取
      child.material = new THREE.MeshPhongMaterial({
        color: originalColor,
        emissive: originalColor, // 发光颜色
        emissiveIntensity: 0.3 // 发光强度
      });
    }
  });
};
// 恢复省份状态
const resetProvince = (province, forceReset = false) => {
  if (!province || (province === selectedProvince && !forceReset)) return;
  province.position.copy(province.userData.originalPosition); // 还原位置
  province.traverse((child) => {
    if (child.isMesh && child.userData.originalMaterial) {
      child.material = child.userData.originalMaterial; // 恢复原材质
      // child.layers.disable(1); // 禁用渲染该材质的图层
      // delete child.userData.originalMaterial; // 清除保存的材质信息
    }
  });
  // 隐藏弹窗
  // 隐藏悬浮时的弹窗
  if (province === hoveredProvince) {
    isTooltipVisible.value = false;
  }

  // 隐藏点击时的弹窗
  if (province === selectedProvince) {
    isClickTooltipVisible.value = false;
  }
};

// 将地理经纬度转换为Three.js的平面坐标
// const lngLatToCoord = (lng, lat) => {
//   const [x, y] = projection([lng, lat]);
//   return [x, -y]; // 注意将 y 值取负，使得地图方向一致
// };
// 创建广告牌
// const addALabel = (data) => {
//   // 创建广告牌 HTML 元素
//   const div = document.createElement('div');
//   div.className = 'label';
//   div.style.background = data.bg;
//   div.innerHTML = `<div class="tip-box" style="background:${data.bg};--base-color:${data.color}"><span class="circle"></span><span class="text">${data.name}</span></div>`;

//   // 转换经纬度到坐标
//   const [x, y] = lngLatToCoord(data.pos[0], data.pos[1]);
//   const labelPosition = new THREE.Vector3(x, y, 12);

//   // 创建 CSS2DObject 并添加到场景中
//   const label = new CSS2DObject(div);
//   label.position.copy(labelPosition);
//   scene.add(label);

//   // 添加一个锥体标识
//   const r = 1;
//   const coneGeometry = new THREE.ConeGeometry(r, r * 2, 4, 1);
//   const material = new THREE.MeshLambertMaterial({
//     color: new THREE.Color(data.color)
//   });
//   const cone = new THREE.Mesh(coneGeometry, material);
//   cone.position.set(x, y, 7);
//   cone.rotateX(-Math.PI * 0.5);
//   cones.push({ obj: cone, step: speed });
//   scene.add(cone);
// };
// const addLine = (posList, color) => {
//   // 将经纬度转换为场景坐标
//   const d = posList.map(([lng, lat]) => lngLatToCoord(lng, lat));

//   // 创建贝塞尔曲线
//   const curve = new THREE.QuadraticBezierCurve3(
//     new THREE.Vector3(d[0][0], d[0][1], 4),
//     new THREE.Vector3(
//       (d[0][0] + d[1][0]) * 0.5,
//       (d[0][1] + d[1][1]) * 0.5,
//       20 // 曲线的高度
//     ),
//     new THREE.Vector3(d[1][0], d[1][1], 4)
//   );

//   // 创建管道几何体并设置材质
//   const geometry = new THREE.TubeGeometry(curve, 32, 0.5, 8, false); // 管道半径调小
//   const material = new THREE.ShaderMaterial({
//     uniforms: {
//       uColor: { value: new THREE.Color(color) }, // 用户指定的颜色
//       uCenter: { value: 0.5 }, // 控制透明度渐变的中心位置
//       uGlowIntensity: { value: 3 } // 发光强度，可调节
//     },
//     transparent: true,
//     vertexShader: `
//         uniform float uCenter; // 中心位置
//         varying float vGradient;
//         void main() {
//           // 计算每个顶点到中心的距离，用于透明度渐变
//           vGradient = abs(uv.x - uCenter);
//           gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
//         }
//       `,
//     fragmentShader: `
//         uniform vec3 uColor;
//         uniform float uGlowIntensity;
//         varying float vGradient;

//         void main() {
//           // 通过距离控制透明度，靠近中心位置时更亮
//           float opacity = mix(1.0, 0.02, vGradient);
//           opacity = pow(opacity, 2.0); // 加强透明度差异
//           gl_FragColor = vec4(uColor, opacity*0.8); // 调节透明度
//         }
//       `
//   });
//   const line = new THREE.Mesh(geometry, material);
//   scene.add(line);

//   // 添加光点
//   const pointGeometry = new THREE.SphereGeometry(0.5, 16, 16);
//   const pointMaterial = new THREE.MeshBasicMaterial({ color: color });
//   const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
//   scene.add(pointMesh);

//   // 光点沿贝塞尔曲线动画
//   const pointState = { t: 0 };
//   // new TWEEN.Tween(pointState)
//   //   .to({ t: 1 }, 3000)
//   //   .yoyo(true)
//   //   .repeat(Infinity)
//   //   .onUpdate(() => {
//   //     const position = curve.getPointAt(pointState.t);
//   //     pointMesh.position.set(position.x, position.y, position.z);
//   //   })
//   //   .start();
//   // 光点沿贝塞尔曲线动画
//   const animatePoint = () => {
//     const pointState = { t: 0 };
//     new TWEEN.Tween(pointState)
//       .to({ t: 1 }, 3000) // 动画持续时间为3000ms
//       .onUpdate(() => {
//         const position = curve.getPointAt(pointState.t);
//         pointMesh.position.set(position.x, position.y, position.z);
//       })
//       .onComplete(() => {
//         pointState.t = 0; // 重置 t 为 0
//         animatePoint(); // 重新开始动画
//       })
//       .start();
//   };
//   animatePoint();
// };

const cone_animate = () => {
  if (cones.length) {
    cones.forEach((c) => {
      if (c.obj.position.z >= 8) {
        c.step = -speed;
      } else if (c.obj.position.z <= 6) {
        c.step = speed;
      }
      c.obj.position.z += c.step;
    });
  }
};

const darkenNonBloomed = (obj: any) => {
  if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
    materials[obj.uuid] = obj.material;
    obj.material = darkMaterial;
  }
};

const restoreMaterial = (obj: any) => {
  if (materials[obj.uuid]) {
    obj.material = materials[obj.uuid];
    delete materials[obj.uuid];
  }
};
const render = () => {
  scene.traverse(darkenNonBloomed);
  labelRenderer.render(scene, camera);
  composer.render();
  scene.traverse(restoreMaterial);
  finalComposer.render();
};
onMounted(async () => {
  const geoJsonData = await loadGeoJson();
  initThree();
  // initMap(geoJsonData);
  const threeMap = new loadMap(mapGroup, projection, scene);
  await threeMap.initialize(geoJsonData);
  cones = threeMap.cones;
  bloomLayer = threeMap.bloomLayer;
  console.log('threeMap.bloomLayer:', scene.children);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);
  window.onresize = function () {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.value?.setSize(width, height);
    composer.setSize(width, height);
    finalComposer.setSize(width, height);
    labelRenderer.setSize(width, height);
    render();
  };
});

onBeforeUnmount(() => {
  if (renderer.value) renderer.value.dispose();
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('click', onClick);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style>
.tooltip {
  position: absolute;
  background-color: rgba(0, 0, 0, 0.7); /* 半透明背景色 */
  color: #ffffff; /* 文字颜色 */
  padding: 5px 10px; /* 内边距 */
  border-radius: 4px; /* 圆角 */
  font-size: 12px;
  pointer-events: none; /* 防止鼠标影响 */
  transform: translate(-50%, -100%); /* 定位在上方居中 */
}
@keyframes big {
  0% {
    transform: scale(0);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes flash {
  0% {
    opacity: 0.3;
  }
  100% {
    opacity: 1;
  }
}

.tip-box {
  --base-color: dodgerblue;
  border: solid 1px var(--base-color);
  background-color: rgba(30, 144, 255, 0.3);
  color: white;
  white-space: nowrap;
  padding-left: 8px;
  padding-right: 16px;
  height: 32px;
  animation: big 1s ease-in;
  border-radius: 16px;
  display: flex;
  align-items: center;
  box-shadow: 0 0 8px var(--base-color);
}
.click-tooltip {
  position: absolute;
  background-color: rgba(0, 0, 0, 0.8);
  color: #ffffff;
  padding: 10px;
  border-radius: 4px;
  font-size: 14px;
  pointer-events: none;
  transform: translate(-50%, -100%);
}
.tip-box .circle {
  background-color: var(--base-color);
  height: 16px;
  width: 16px;
  border-radius: 50%;
  animation: flash 0.5s ease-in alternate infinite;
}

::v-deep(.tip-box .text) {
  margin: 0 8px;
}
</style>
