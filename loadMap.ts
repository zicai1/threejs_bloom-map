// MapInitializer.ts
import * as THREE from 'three';
import * as d3 from 'd3';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import * as TWEEN from '@tweenjs/tween.js';
import { MeshLine, MeshLineMaterial } from 'three.meshline';
type Position = [number, number];

interface LabelData {
  color: string;
  bg: string;
  pos: Position;
  name: string;
}

interface GeoJsonFeature {
  type: string;
  properties: {
    name: string;
    center: Position;
  };
  geometry: {
    type: string;
    coordinates: any[];
  };
}

interface MapOptions {
  routes?: Position[][];
  labels?: LabelData[];
}

export default class MapInitializer {
  private scene: THREE.Scene;
  private mapGroup: THREE.Group;
  private lineGroup: THREE.Group;
  private projection: d3.GeoProjection;
  private COLOR_ARR: string[];
  private defaultRoutes: Position[][] = [
    [
      [116.405285, 39.904989], // 北京的经纬度
      [121.473701, 31.230416] // 上海的经纬度
    ],
    [
      [108.5545, 34.1524], // 西安的经纬度
      [117.0052, 36.430416] // 济南的经纬度
    ]
  ];
  private defaultLabels: LabelData[] = [
    {
      color: 'rgb(255 ,99, 71)',
      bg: 'rgba(255 ,99, 71, 0.3)',
      pos: [116.405285, 39.904989],
      name: '北京市'
    },
    {
      color: 'rgb(255, 215, 0)',
      bg: 'rgba(255, 215,0, 0.3)',
      pos: [108.5545, 34.1524],
      name: '西安市'
    }
  ];
  public cones: any[];
  public bloomLayer: THREE.Layers;
  private speed: number;
  private BLOOM_SCENE: number = 1;
  private material: MeshLineMaterial;
  constructor(
    mapGroup: THREE.Group,
    projection: d3.GeoProjection,
    scene: THREE.Scene,
    private mapOptions: MapOptions = {}
  ) {
    this.scene = scene;
    this.mapGroup = mapGroup;
    this.lineGroup = new THREE.Group();
    this.projection = projection;
    this.COLOR_ARR = ['#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#A1FF33'];
    this.cones = [];
    this.bloomLayer = new THREE.Layers();
    this.bloomLayer.set(this.BLOOM_SCENE);
    this.speed = 0.04;
    // Initialize with provided or default routes and labels
    const routes = this.mapOptions.routes || this.defaultRoutes;
    const labels = this.mapOptions.labels || this.defaultLabels;
    this.addRoutesAndLabels(routes, labels);
    this.material = new MeshLineMaterial({
      color: new THREE.Color('#0fb1fb'), // 设置颜色
      lineWidth: 0.3, // 设置线宽
      transparent: true, // 开启透明度
      opacity: 1, // 设置透明度
      depthTest: true // 深度测试
    });
  }

  initialize(chinaJson: { features: GeoJsonFeature[] }): void {
    chinaJson.features.forEach((elem, index) => {
      const province = this.addProvince(elem, index);
      this.mapGroup.add(province);
    });
    this.scene.add(this.lineGroup);
    this.scene.add(this.mapGroup);
  }

  private addProvince(elem: GeoJsonFeature, index: number): THREE.Object3D {
    const province = new THREE.Object3D();
    const color = new THREE.Color(
      this.COLOR_ARR[index % this.COLOR_ARR.length]
    );

    province.userData = {
      name: elem.properties.name,
      center: elem.properties.center,
      originalPosition: province.position.clone()
    };

    elem.geometry.coordinates.forEach((multiPolygon: any[]) => {
      this.processCoordinates(multiPolygon, province, color, index);
    });

    province.traverse((child: THREE.Object3D) => {
      if (
        (child as THREE.Mesh).isMesh &&
        !(child.userData as any).originalMaterial
      ) {
        (child.userData as any).originalMaterial = (
          child as THREE.Mesh
        ).material;
      }
    });

    return province;
  }

  private processCoordinates(
    coords: any[],
    province: THREE.Object3D,
    color: THREE.Color,
    index: number
  ): void {
    if (Array.isArray(coords[0][0])) {
      coords.forEach((subCoords: any[]) =>
        this.processCoordinates(subCoords, province, color, index)
      );
    } else {
      this.processPolygon(coords, province, color, index);
    }
  }

  private processPolygon(
    polygon: any[],
    province: THREE.Object3D,
    color: THREE.Color,
    index: number
  ): void {
    const shape = new THREE.Shape();
    polygon.forEach(([x, y], i: number) => {
      const [projX, projY] = this.projection([x, y]);
      i === 0 ? shape.moveTo(projX, -projY) : shape.lineTo(projX, -projY);
    });

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 4,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelThickness: 0.2
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const material = new THREE.MeshPhongMaterial({
      color
    });
    const material1 = new THREE.MeshStandardMaterial({
      metalness: 1,
      roughness: 1,
      color
    });
    const mesh = new THREE.Mesh(geometry, [material, material1]);
    if (index % 2 === 0) mesh.scale.set(1, 1, 1.2);
    mesh.position.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { color };
    mesh.layers.enable(this.BLOOM_SCENE);
    this.changeModelMaterial(mesh, this.lineGroup);
    province.add(mesh);
  }

  private changeModelMaterial(
    object: THREE.Object3D,
    lineGroup: THREE.Group
  ): any {
    const mesh: THREE.Mesh = object as any;
    if (mesh.isMesh) {
      const quaternion = new THREE.Quaternion();
      const worldPos = new THREE.Vector3();
      const worldScale = new THREE.Vector3();
      // 获取四元数
      mesh.getWorldQuaternion(quaternion);
      // 获取位置信息
      mesh.getWorldPosition(worldPos);
      // 获取缩放比例
      mesh.getWorldScale(worldScale);

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => {
          if (
            mat instanceof THREE.MeshPhongMaterial ||
            mat instanceof THREE.MeshStandardMaterial
          ) {
            mat.transparent = true;
            mat.opacity = 0.4;
          }
        });
      } else if (
        mesh.material instanceof THREE.MeshPhongMaterial ||
        mesh.material instanceof THREE.MeshStandardMaterial
      ) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0.4;
      }

      // 以模型顶点信息创建线条
      const line = this.getLine(mesh, 30, undefined, 1);
      // 给线段赋予模型相同的坐标信息
      line.quaternion.copy(quaternion);
      line.position.copy(worldPos);
      line.scale.copy(worldScale);
      lineGroup.add(line);
    }
  }
  /**
   * 根据输入的mesh，生成边缘线条
   * 使用MeshLine库生成的线条，是一个mesh对象，具有宽度，详细信息见 https://github.com/spite/THREE.MeshLine?tab=readme-ov-file
   * @param object - 一个threejs的mesh对象，用于生成边缘线条
   * @param thresholdAngle - 生成线条的角度阈值，当相邻面的法线之间的角度大于这个阈值时，会生成一条边
   * @param color - 生成线条的颜色，默认为new THREE.Color('#0fb1fb')
   * @param opacity - 生成线条的透明度，默认为1
   */
  public getLine(
    object: THREE.Mesh,
    thresholdAngle,
    color = new THREE.Color('#0fb1fb'),
    opacity = 1
  ): MeshLine {
    // 创建线条，参数为 几何体模型，相邻面的法线之间的角度，
    const edges = new THREE.EdgesGeometry(object.geometry, thresholdAngle);
    const points: THREE.Vector3[] = [];
    const positionAttr = edges.attributes.position;
    if (!positionAttr || !positionAttr.array) {
      return null;
    }
    const position: Float32Array = positionAttr.array as Float32Array;
    for (let i = 0; i < position.length; i += 3) {
      points.push(
        new THREE.Vector3(position[i], position[i + 1], position[i + 2])
      );
    }
    if (points.length === 0) {
      return null as any;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new MeshLine();
    line.setGeometry(geometry);
    this.material.opacity = opacity;
    this.material.color = color;
    const line_mesh = new THREE.Mesh(line, this.material);
    line_mesh.layers.enable(this.BLOOM_SCENE);
    return line_mesh;
  }

  private addRoutesAndLabels(routes: Position[][], labels: LabelData[]): void {
    routes.forEach((posList, idx) => {
      const color = idx === 0 ? 'rgb(255 ,99, 71)' : 'rgb(255, 215, 0)';
      this.addLine(posList, color);
    });

    labels.forEach((labelData) => {
      this.addALabel(labelData);
    });
  }

  /**
   * 添加一条贝塞尔曲线在给定的两个点之间，参数接受为两个地点的经纬度
   * 添加的贝塞尔曲线为三次贝塞尔曲线，不接受高度的指定，默认为 4
   * 另外添加一个光点在生成的贝塞尔曲线上移动，光点颜色与贝塞尔曲线颜色相同
   * @param posList - 一个地理经纬度坐标的列表 [longitude, latitude]
   * @param color -光点的颜色.
   *
   * @example
   * const posList: Position[] = [
   *   [116.405285, 39.904989], // Beijing
   *   [121.473701, 31.230416]  // Shanghai
   * ];
   * addLine(posList, 'rgb(255, 99, 71)');
   */
  public addLine(posList: Position[], color: string): void {
    const d = posList.map(([lng, lat]) => this.lngLatToCoord(lng, lat));
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(d[0][0], d[0][1], 4),
      new THREE.Vector3(
        (d[0][0] + d[1][0]) * 0.5,
        (d[0][1] + d[1][1]) * 0.5,
        20
      ),
      new THREE.Vector3(d[1][0], d[1][1], 4)
    );

    const geometry = new THREE.TubeGeometry(curve, 32, 0.5, 8, false);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) }, // 用户指定的颜色
        uCenter: { value: 0.5 }, // 控制透明度渐变的中心位置
        uGlowIntensity: { value: 3 } // 发光强度，可调节
      },
      transparent: true,
      vertexShader: `
          uniform float uCenter; // 中心位置
          varying float vGradient;
          void main() {
            // 计算每个顶点到中心的距离，用于透明度渐变
            vGradient = abs(uv.x - uCenter);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
      fragmentShader: `
          uniform vec3 uColor;
          uniform float uGlowIntensity;
          varying float vGradient;

          void main() {
            // 通过距离控制透明度，靠近中心位置时更亮
            float opacity = mix(1.0, 0.02, vGradient);
            opacity = pow(opacity, 2.0); // 加强透明度差异
            gl_FragColor = vec4(uColor, opacity*0.8); // 调节透明度
          }
        `
    });
    const line = new THREE.Mesh(geometry, material);
    // 添加光点
    const pointGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const pointMaterial = new THREE.MeshBasicMaterial({ color: color });
    const pointMesh = new THREE.Mesh(pointGeometry, pointMaterial);
    // 光点沿贝塞尔曲线动画
    const animatePoint = () => {
      const pointState = { t: 0 };
      new TWEEN.Tween(pointState)
        .to({ t: 1 }, 3000) // 动画持续时间为3000ms
        .onUpdate(() => {
          const position = curve.getPointAt(pointState.t);
          pointMesh.position.set(position.x, position.y, position.z);
        })
        .onComplete(() => {
          pointState.t = 0; // 重置 t 为 0
          animatePoint(); // 重新开始动画
        })
        .start();
    };
    animatePoint();
    this.scene.add(pointMesh);

    this.scene.add(line);
  }
  /**
   * 添加一个广告牌和圆柱体在给定的经纬度位置上，参数接受为一个data对象，对象包含了name,pos,bg,color属性
   * name属性为广告牌的名称，pos属性为广告牌的位置，bg属性为广告牌的背景颜色，color属性为广告牌的文字颜色，此外圆锥体的颜色也是这个
   *
   * @param data - 一个字典，包含color,bg,pos,name等key值
   *
   * @example
   * addALabel({
   *   color: 'rgb(255 ,99, 71)',
   *   bg: 'rgba(255 ,99, 71, 0.3)',
   *   pos: [116.405285, 39.904989], // 北京的位置
   *   name: '北京市'
   * });
   */
  public addALabel(data: LabelData): void {
    const div = document.createElement('div');
    div.className = 'label';
    div.style.background = data.bg;
    div.innerHTML = `<div class="tip-box" style="background:${data.bg};--base-color:${data.color}"><span class="circle"></span><span class="text">${data.name}</span></div>`;

    const [x, y] = this.lngLatToCoord(data.pos[0], data.pos[1]);
    const labelPosition = new THREE.Vector3(x, y, 12);

    const label = new CSS2DObject(div);
    label.position.copy(labelPosition);
    // 添加一个锥体标识
    const r = 1;
    const coneGeometry = new THREE.ConeGeometry(r, r * 2, 4, 1);
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(data.color)
    });
    const cone = new THREE.Mesh(coneGeometry, material);
    cone.position.set(x, y, 7);
    cone.rotateX(-Math.PI * 0.5);
    this.cones.push({ obj: cone, step: this.speed });
    this.scene.add(cone);
    this.scene.add(label);
  }

  private lngLatToCoord(lng: number, lat: number): [number, number] {
    const [x, y] = this.projection([lng, lat]);
    return [x, -y];
  }
}
