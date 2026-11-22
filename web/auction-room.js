import * as T from "./vendor/three.module.min.js";

const STAGE_Z = -10.2;
const UP = new T.Vector3(0, 1, 0);
const limbDirection = new T.Vector3();
const PALETTE = [0xb97755, 0xe6b089, 0x8a4b37, 0xd99a6d, 0xa96e55];
const SUITS = [0x1a2334, 0x252738, 0x332928, 0x1b3238, 0x282b2e];
const easing = (value) => value * value * (3 - 2 * value);

function group(parent, x = 0, y = 0, z = 0) {
  const node = new T.Group();
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

const boxGeometry = new T.BoxGeometry();
const ovalGeometry = new T.SphereGeometry(1, 20, 14);
const cylinderGeometry = new T.CylinderGeometry(1, 1, 1, 24);
const material = (color, properties = {}) => new T.MeshStandardMaterial({ color, roughness: .63, ...properties });

function mesh(parent, geometry, surface, x, y, z, sx, sy, sz) {
  const node = new T.Mesh(geometry, surface);
  node.position.set(x, y, z);
  node.scale.set(sx, sy, sz);
  parent.add(node);
  return node;
}

function box(parent, surface, x, y, z, width, height, depth) {
  return mesh(parent, boxGeometry, surface, x, y, z, width, height, depth);
}

function oval(parent, surface, x, y, z, sx, sy, sz) {
  return mesh(parent, ovalGeometry, surface, x, y, z, sx, sy, sz);
}

function cylinder(parent, surface, x, y, z, radius, height) {
  return mesh(parent, cylinderGeometry, surface, x, y, z, radius, height, radius);
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return { texture, draw: (value) => {
    paint(ctx, canvas.width, canvas.height, value);
    texture.needsUpdate = true;
  } };
}

const walnut = material(0x644231, { roughness: .42 });
const gold = material(0xc49a56, { metalness: .65, roughness: .38 });
const dark = material(0x141922);
const cloth = material(0x202838, { roughness: .95 });
const shirt = material(0xe1dacf);
const hair = material(0x1c1512);
const white = material(0xe7ddd3);
const iris = material(0x353022);
const paper = material(0xd5cab2);
const screen = new T.MeshBasicMaterial({ color: 0x294157 });
let woodTexture;

function prepareMaterials() {
  if (woodTexture) return;
  woodTexture = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = "#765645";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 460; i++) {
      const y = i * 7.37 % h;
      ctx.strokeStyle = i % 3 ? "#37201632" : "#f6bc8430";
      ctx.lineWidth = i % 4 === 0 ? 1.6 : .55;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * .35, y - Math.sin(i) * 4, w * .62, y + Math.cos(i) * 7, w, y - 1);
      ctx.stroke();
    }
  });
  woodTexture.draw();
  walnut.color.set(0xeee3d8);
  walnut.map = woodTexture.texture;
  walnut.needsUpdate = true;
}

function panelTexture(initials, color) {
  const badge = new Image();
  const sign = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = "#141b29";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f6e9d0";
    ctx.font = "bold 51px Georgia";
    if (badge.naturalWidth) {
      ctx.drawImage(badge, 23, 13, 102, 102);
      ctx.fillText(initials, 177, 81, 110);
    } else {
      ctx.fillText(initials, w / 2, 81);
    }
  });
  badge.onload = () => sign.draw();
  badge.src = `/assets/team-badges/${initials.toLowerCase()}.webp`;
  sign.draw();
  return new T.MeshBasicMaterial({ map: sign.texture });
}

function limb(parent, surface, radius) {
  return mesh(parent, cylinderGeometry, surface, 0, 0, 0, radius, 1, radius);
}

function setLimb(node, from, to) {
  limbDirection.subVectors(to, from);
  node.position.copy(from).lerp(to, .5);
  node.scale.y = limbDirection.length();
  node.quaternion.setFromUnitVectors(UP, limbDirection.normalize());
}

function makeDelegate(parent, x, y, z, variant, accent, standing = false, paddleEnabled = false, auctioneer = false) {
  const actor = group(parent, x, y, z);
  const torso = group(actor);
  const skin = material(PALETTE[variant % PALETTE.length], { roughness: .79 });
  const lips = material(new T.Color(PALETTE[variant % PALETTE.length]).multiplyScalar(.76));
  const suit = material(auctioneer ? 0x254450 : SUITS[variant % SUITS.length]);
  const tie = material(accent);
  const baseY = standing ? .28 : 0;
  oval(torso, suit, 0, 1.05 + baseY, 0, .23, .29, .13);
  oval(torso, shirt, 0, 1.17 + baseY, .116, .078, .18, .023);
  if (auctioneer) {
    for (const side of [-1, 1]) {
      box(torso, tie, side * .05, 1.19 + baseY, .137, .026, .17, .012).rotation.z = -side * .32;
    }
  } else {
    box(torso, tie, 0, 1.11 + baseY, .142, .035, .14, .013).rotation.z = -.04;
  }
  cylinder(torso, skin, 0, 1.32 + baseY, 0, .062, .10);
  const head = group(torso, 0, 1.46 + baseY, .012);
  oval(head, skin, 0, 0, 0, .101, .137, .097);
  oval(head, skin, 0, -.066, .025, .083, .068, .072);
  oval(head, hair, 0, .070 + (variant % 3) * .006, -.029, .104, .080, .088);
  oval(head, hair, 0, .025, -.074, .093, .102, .049);
  if (auctioneer) {
    oval(head, hair, 0, .114, -.092, .082, .077, .069);
    oval(head, hair, -.033, .083, .036, .074, .052, .068).rotation.z = -.27;
    for (const side of [-1, 1]) {
      oval(head, gold, side * .106, -.038, .012, .012, .021, .013);
    }
  }
  oval(head, skin, 0, -.014, .094, .024, .033, .033);
  for (const side of [-1, 1]) {
    oval(head, skin, side * .101, -.011, -.004, .016, .030, .019);
    oval(head, skin, side * .057, -.038, .062, .039, .041, .037);
    oval(head, white, side * .038, .019, .089, .023, .011, .011);
    oval(head, iris, side * .037, .019, .1, .008, .009, .004);
    const brow = oval(head, hair, side * .038, .042, .087, .025, .006, .008);
    brow.rotation.z = side * .09;
  }
  oval(head, lips, 0, -.066, .092, .036, .007, .008);
  if (!auctioneer && variant % 4 === 1) {
    const frame = new T.TorusGeometry(.027, .003, 5, 20);
    for (const side of [-1, 1]) mesh(head, frame, dark, side * .037, .018, .105, 1, .70, 1);
    box(head, dark, 0, .02, .105, .023, .003, .005);
  }
  if (!standing) {
    box(actor, dark, 0, .55, -.16, .46, .10, .42);
    box(actor, cloth, 0, .85, -.24, .44, .56, .09);
  }
  const arms = [-1, 1].map((side) => {
    const upper = limb(torso, suit, .066);
    const forearm = limb(torso, suit, .053);
    const elbow = oval(torso, suit, 0, 0, 0, .055, .055, .055);
    const palm = group(torso);
    oval(palm, skin, 0, 0, 0, .035, .045, .031);
    for (let i = 0; i < 4; i++) oval(palm, skin, (i - 1.5) * .015, .027, .008, .009, .029 - Math.abs(i - 1.5) * .003, .010);
    oval(palm, skin, -.029, .005, .021, .016, .023, .013).rotation.z = -.45;
    return {
      side, upper, forearm, elbow, palm,
      shoulder: new T.Vector3(side * .19, 1.20 + baseY, 0),
      bend: new T.Vector3(),
      hand: new T.Vector3(),
    };
  });
  const paddle = group(arms[1].palm, .006, .014, .013);
  cylinder(paddle, gold, 0, .10, 0, .012, .21);
  const plate = cylinder(paddle, material(accent), 0, .25, 0, .086, .021);
  plate.rotation.x = Math.PI / 2;
  paddle.visible = paddleEnabled;
  return {
    actor,
    animate(t, raised, hammer = 0) {
      head.rotation.set(.025 + .035 * Math.sin(t * 1.7 + variant) + hammer * .17, .12 * Math.sin(t * .7 + variant) + raised * .20, .035 * Math.sin(t + variant));
      torso.rotation.x = -.025 + raised * .13 + hammer * .10;
      for (const arm of arms) {
        const lift = arm.side === 1 ? raised : 0;
        arm.bend.set(arm.side * (.254 + .08 * lift), .95 + baseY + .29 * lift, .10 + .045 * lift);
        arm.hand.set(arm.side * (.205 + .06 * lift), .985 + baseY + .55 * lift - hammer * .13, .385 - .22 * lift + hammer * .12);
        setLimb(arm.upper, arm.shoulder, arm.bend);
        setLimb(arm.forearm, arm.bend, arm.hand);
        arm.elbow.position.copy(arm.bend);
        arm.palm.position.copy(arm.hand);
        arm.palm.rotation.set(.68 * (1 - lift), -.18 * arm.side, -.24 * lift);
      }
    },
    hand: arms[1].palm,
  };
}

function makeTable(scene, code, color, x, z, angle, index, isUser) {
  const table = group(scene, x, 0, z);
  table.rotation.y = angle;
  table.userData.team = code;
  const accent = material(color, { roughness: .8, emissive: color, emissiveIntensity: .22 });
  const edge = new T.MeshBasicMaterial({ color });
  box(table, dark, 0, .026, -.28, 3.85, .052, 2.79);
  box(table, material(color, { emissive: color, emissiveIntensity: .15 }), 0, .055, -.28, 3.76, .024, 2.69);
  for (const side of [-1, 1]) {
    box(table, edge, side * 1.89, .078, -.28, .024, .025, 2.74);
    box(table, edge, 0, .078, -.28 + side * 1.36, 3.76, .025, .027);
    for (const z of [-.87, .38]) box(table, gold, side * 1.88, .26, z, .035, .38, .035);
  }
  const base = box(table, accent, 0, .49, 0, 2.74, .88, 1.00);
  base.receiveShadow = true;
  box(table, paper, 0, .985, 0, 2.85, .10, 1.10).receiveShadow = true;
  box(table, edge, 0, .88, .509, 2.72, .02, .016);
  box(table, accent, 0, .39, .513, 2.69, .57, .025);
  const sign = panelTexture(code, color);
  box(table, sign, 0, .57, .542, .66, .28, .015);
  const seatSign = box(table, sign, .85, 1.10, -.02, .4, .20, .03);
  seatSign.rotation.y = Math.PI;
  const lamp = box(table, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0 }), 0, 1.04, .42, 2.43, .017, .03);
  for (const col of [-1, 0, 1]) {
    const laptop = group(table, col * .72, 1.046, -.05);
    box(laptop, dark, 0, .012, 0, .30, .024, .22);
    box(laptop, dark, 0, .105, .085, .30, .20, .021).rotation.x = -.25;
    box(laptop, screen, 0, .108, .071, .265, .166, .007).rotation.x = -.25;
    box(table, paper, col * .68 - .20, 1.045, .16, .16, .014, .21);
    cylinder(table, white, col * .7 + .21, 1.105, .04, .035, .11);
  }
  const people = [-.76, 0, .76].map((offset, seat) =>
    makeDelegate(table, offset, 0, -.77, index * 3 + seat, color, false, seat === 1));
  const rowSign = box(table, sign, 0, .73, -1.58, .83, .25, .02);
  rowSign.rotation.y = Math.PI;
  const bidder = people[1];
  if (isUser) {
    bidder.actor.position.x = -.16;
    people[0].actor.position.x = -.99;
  }
  return { table, lamp, people, bidder, raisedAt: -Infinity };
}

function makeHall(scene) {
  scene.background = new T.Color(0x080d21);
  scene.fog = new T.FogExp2(0x090e25, .013);
  scene.add(new T.HemisphereLight(0xe5edff, 0x2858b0, 2.40));
  const key = new T.DirectionalLight(0xffeddb, 2.55);
  key.position.set(2, 9, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -13, right: 13, top: 14, bottom: -14, near: 1, far: 32 });
  key.shadow.normalBias = .025;
  scene.add(key, key.target);
  const rim = new T.DirectionalLight(0x72a6ff, 2.2);
  rim.position.set(-4, 5, 9);
  scene.add(rim);

  const carpetSurface = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#282b38";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5600; i++) {
      const x = (i * 73.13) % w;
      const y = (i * i * .513) % h;
      ctx.fillStyle = i % 2 ? "#a8a0b017" : "#04091234";
      ctx.fillRect(x, y, 1.5, .9);
    }
    ctx.strokeStyle = "#6d657242";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
  carpetSurface.draw();
  carpetSurface.texture.wrapS = carpetSurface.texture.wrapT = T.RepeatWrapping;
  carpetSurface.texture.repeat.set(16, 18);
  box(scene, material(0x7294e1, { map: carpetSurface.texture, roughness: .48 }), 0, -.15, -.25, 29, .3, 34).receiveShadow = true;
  box(scene, material(0x153c89, { roughness: .36 }), 0, .008, -.45, 2.7, .018, 23).receiveShadow = true;
  const wall = material(0x101831);
  const trim = new T.MeshBasicMaterial({ color: 0x408cff });
  for (const side of [-1, 1]) {
    box(scene, wall, side * 13.15, 3.4, -.6, .45, 6.8, 26);
    for (let i = 0; i < 8; i++) {
      const z = -11.5 + i * 3.1;
      box(scene, cloth, side * 12.87, 2.75, z, .13, 5.5, 2.80);
      box(scene, trim, side * 12.75, 3.7, z + .95, .04, 1.55, .04);
      box(scene, trim, side * 12.75, .24, z, .055, .025, 2.46);
    }
  }
  box(scene, wall, 0, 4.2, -14, 27, 8.4, .28);
  for (const z of [-8.4, -3.5, 1.4, 6.4]) {
    const pool = new T.PointLight(z < 0 ? 0x528dff : 0xd9ebff, 50, 14, 2);
    pool.position.set(0, 5.8, z);
    scene.add(pool);
  }
}

function makeStage(scene) {
  const stageBlue = material(0x153a96, { roughness: .32, emissive: 0x142277, emissiveIntensity: .5 });
  const neon = new T.MeshBasicMaterial({ color: 0x5ba2ff });
  const ice = new T.MeshBasicMaterial({ color: 0xe0edff });
  box(scene, stageBlue, 0, .26, STAGE_Z, 19.8, .52, 4.1).receiveShadow = true;
  box(scene, ice, 0, .45, STAGE_Z + 2.05, 19.8, .045, .022);
  for (const [width, height, depth] of [[11.8, 8, -9.0], [9.6, 7.1, -9.45]]) {
    const path = new T.CatmullRomCurve3([
      new T.Vector3(-width, .5, depth), new T.Vector3(-width, height * .63, depth),
      new T.Vector3(-width * .8, height, depth), new T.Vector3(0, height * 1.04, depth),
      new T.Vector3(width * .8, height, depth), new T.Vector3(width, height * .63, depth),
      new T.Vector3(width, .5, depth),
    ], false, "centripetal");
    scene.add(new T.Mesh(new T.TubeGeometry(path, 48, .21, 6, false), neon));
  }
  box(scene, dark, 0, .05, STAGE_Z + 2.22, 5, .10, .66);
  box(scene, dark, 0, .14, STAGE_Z + 1.93, 5, .22, .56);
  box(scene, gold, 0, .49, STAGE_Z + 1.91, 13.5, .025, .023);
  const emblem = new Image();
  let boardData = ["Auction Room", "", "2025 Mega Auction"];
  const scoreboard = canvasTexture(2048, 840, (ctx, width, height, data) => {
    const w = width / 2;
    const h = height / 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const [name, amount, line, color, metrics = []] = data;
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    const theme = new T.Color(color || "#3970cf");
    const bright = .2126 * theme.r + .7152 * theme.g + .0722 * theme.b > .48;
    gradient.addColorStop(0, `#${theme.clone().multiplyScalar(.48).getHexString()}`);
    gradient.addColorStop(.5, `#${theme.clone().multiplyScalar(.28).getHexString()}`);
    gradient.addColorStop(1, `#${theme.clone().multiplyScalar(.56).getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `#${theme.clone().lerp(new T.Color(0xffffff), .48).getHexString()}`;
    ctx.lineWidth = 3;
    ctx.strokeRect(21, 21, w - 42, h - 42);
    if (emblem.complete && emblem.naturalWidth) ctx.drawImage(emblem, 40, 39, 64, 64);
    ctx.fillStyle = bright ? "#080d15" : "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "600 27px system-ui";
    ctx.fillText(line.toUpperCase(), w / 2, 79, w - 235);
    ctx.fillStyle = bright ? "#080d15" : "#fff4dc";
    ctx.font = "bold 74px system-ui";
    ctx.fillText(name, w / 2, 181, w - 110);
    ctx.font = "600 54px system-ui";
    ctx.fillText(amount, w / 2, 264);
    metrics.forEach(([label, value], i) => {
      const cell = (w - 90) / metrics.length;
      const left = 45 + i * cell;
      ctx.fillStyle = "#080d1594";
      ctx.fillRect(left + 5, 293, cell - 10, 87);
      ctx.fillStyle = "#f1f4ff";
      ctx.font = "600 21px system-ui";
      ctx.fillText(label.toUpperCase(), left + cell / 2, 324, cell - 18);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px system-ui";
      ctx.fillText(value, left + cell / 2, 363, cell - 18);
    });
  });
  function drawBoard(data) {
    boardData = data;
    scoreboard.draw(data);
  }
  emblem.onload = () => drawBoard(boardData);
  emblem.src = "/assets/auction-room.svg";
  drawBoard(boardData);
  const boardMaterial = new T.MeshBasicMaterial({ map: scoreboard.texture, toneMapped: false });
  for (const [x, y, width, depth, angle] of [[0, 4.02, 10.8, -1.30, 0], [-8.10, 2.77, 4.25, -.85, .13], [8.10, 2.77, 4.25, -.85, -.13]]) {
    const board = group(scene, x, y, STAGE_Z + depth);
    board.rotation.y = angle;
    box(board, neon, 0, 0, -.08, width + .16, width * .410 + .16, .10);
    const display = new T.Mesh(new T.PlaneGeometry(width, width * .410), boardMaterial);
    board.add(display);
  }
  const auctioneer = makeDelegate(scene, -.82, .48, STAGE_Z + .54, 9, "#ad7949", true, false, true);
  box(scene, walnut, -.82, 1.05, STAGE_Z + 1, .78, 1.08, .63).receiveShadow = true;
  box(scene, dark, -.82, 1.61, STAGE_Z + 1, .85, .08, .66);
  box(scene, gold, -.82, 1.33, STAGE_Z + 1.324, .49, .025, .025);
  cylinder(scene, walnut, -.46, 1.667, STAGE_Z + 1.22, .115, .055);
  const gavel = group(scene, -.47, 1.695, STAGE_Z + 1.22);
  box(gavel, walnut, .0, .007, .105, .035, .035, .25);
  const head = cylinder(gavel, walnut, 0, .012, -.026, .050, .14);
  head.rotation.z = Math.PI / 2;
  box(gavel, gold, 0, .012, -.026, .032, .104, .104);
  return { drawBoard, auctioneer, gavel };
}

export function createRoom(host, labels, handlers) {
  prepareMaterials();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: false, antialias: true });
  if (!context) throw new Error("WebGL 2 unavailable");
  const renderer = new T.WebGLRenderer({ canvas, context, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 1.35), 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(53, 1, .14, 55);
  const stage = makeStage(scene);
  makeHall(scene);
  const floorTables = new Map();
  const tableRoot = group(scene);
  const spotlight = new T.SpotLight(0xffdf9c, 0, 15, .27, .65);
  scene.add(spotlight, spotlight.target);
  const spotlightBeam = new T.Mesh(
    new T.CylinderGeometry(.10, 1.95, 8, 40, 1, true),
    new T.ShaderMaterial({
      uniforms: { beamColor: { value: new T.Color(0xffffff) } },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `
        varying vec3 beamNormal;
        varying vec3 viewDirection;
        varying float beamHeight;
        void main() {
          vec4 viewPoint = modelViewMatrix * vec4(position, 1.0);
          beamNormal = normalize(normalMatrix * normal);
          viewDirection = -viewPoint.xyz;
          beamHeight = uv.y;
          gl_Position = projectionMatrix * viewPoint;
        }
      `,
      fragmentShader: `
        uniform vec3 beamColor;
        varying vec3 beamNormal;
        varying vec3 viewDirection;
        varying float beamHeight;
        void main() {
          float body = max(0.0, dot(normalize(beamNormal), normalize(viewDirection)));
          float edgeFade = smoothstep(0.0, 0.13, beamHeight);
          gl_FragColor = vec4(beamColor, pow(body, 1.35) * edgeFade * 0.42);
        }
      `,
    }),
  );
  spotlightBeam.visible = false;
  scene.add(spotlightBeam);
  const spotlightRing = new T.Mesh(
    new T.RingGeometry(1.79, 1.85, 48),
    new T.MeshBasicMaterial({ color: 0xffdfa0, transparent: true, opacity: .68 }),
  );
  spotlightRing.rotation.x = -Math.PI / 2;
  spotlightRing.scale.x = 1.12;
  spotlightRing.visible = false;
  scene.add(spotlightRing);
  const labelPoint = new T.Vector3();
  let leader;
  const aim = new T.Vector3();
  const cameraPos = new T.Vector3();
  const cameraAim = new T.Vector3();
  const ray = new T.Raycaster();
  const pointer = new T.Vector2();
  const clock = performance.now();
  let visible = false;
  let wide = false;
  let revealing = false;
  let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let user;
  let frame = 0;
  let previousTime;
  let sale;
  let callCue;
  let callStarted = 0;
  let cameraReady = false;
  const gavelRest = stage.gavel.position.clone();
  const gavelHand = new T.Vector3();

  function configure(code, colors, names) {
    if (user === code) return;
    user = code;
    leader = null;
    spotlight.intensity = 0;
    spotlightRing.visible = false;
    spotlightBeam.visible = false;
    for (const old of floorTables.values()) {
      old.table.traverse(node => {
        if (!node.isMesh || [boxGeometry, ovalGeometry, cylinderGeometry].includes(node.geometry)) return;
        node.geometry.dispose();
      });
      old.table.removeFromParent();
    }
    floorTables.clear();
    labels.replaceChildren();
    const other = Object.keys(colors).filter(key => key !== code);
    other.splice(7, 0, code);
    other.forEach((team, index) => {
      const front = index >= 5;
      const x = (index % 5 - 2) * (front ? 4.45 : 4.05);
      const z = (front ? 6.46 : .6) - x * x * .023;
      const desk = makeTable(tableRoot, team, colors[team], x, z, Math.atan2(-x * .52, STAGE_Z - z), index, team === code);
      const label = document.createElement("span");
      label.textContent = names[team];
      label.style.setProperty("--table-color", colors[team]);
      labels.append(label);
      floorTables.set(team, { ...desk, label, color: colors[team] });
    });
    cameraReady = false;
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    handlers.unavailable();
  });
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) * 2 / rect.width - 1, 1 - (event.clientY - rect.top) * 2 / rect.height);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(tableRoot, true)[0];
    let node = hit?.object;
    while (node && !node.userData.team) node = node.parent;
    if (node?.userData.team) handlers.table(node.userData.team);
  });

  function animate(now) {
    if (!visible) return;
    const seconds = (now - clock) / 1000;
    const dt = previousTime == null ? .016 : Math.min(.08, (now - previousTime) / 1000);
    previousTime = now;
    const sinceSale = sale ? (now - sale.at) / 1000 : Infinity;
    const cut = sale?.featured && !reducedMotion && !wide && sinceSale > .38 && sinceSale < 2.20;
    const focus = floorTables.get(sale?.team);
    const overview = wide && !(cut && focus);
    const portraitDistance = overview ? Math.max(0, 1 / camera.aspect - 1) * 8 : 0;
    camera.fov = overview ? Math.max(revealing ? 62 : 51, Math.min(94, 61 / camera.aspect)) : camera.aspect < 1 ? 66 : 53;
    camera.updateProjectionMatrix();
    if (cut && focus) {
      const point = focus.table.position;
      cameraPos.set(point.x * .67, 2.25, point.z - 2.75);
      cameraAim.set(point.x, 1.13, point.z);
    } else if (wide) {
      cameraPos.set(0, 13.4 + portraitDistance * .34, 22.6 + portraitDistance);
      cameraAim.set(0, -.65, -1.6);
    } else {
      const desk = floorTables.get(user)?.table;
      cameraPos.set(.22, 3.25, -5.65);
      if (desk) desk.localToWorld(cameraPos);
      else cameraPos.z = 12.11;
      cameraAim.set(0, .95, -7.55);
    }
    const step = cameraReady && !reducedMotion ? 1 - Math.exp(-dt * 5.8) : 1;
    camera.position.lerp(cameraPos, step);
    aim.lerp(cameraAim, step);
    camera.lookAt(aim);
    cameraReady = true;
    camera.updateMatrixWorld();
    labels.hidden = !overview;
    for (const [team, table] of floorTables) {
      if (overview) {
        table.table.localToWorld(labelPoint.set(0, .04, -1.97)).project(camera);
        table.label.style.left = `${(labelPoint.x + 1) * 50}%`;
        table.label.style.top = `${(1 - labelPoint.y) * 50}%`;
      }
      const since = (now - table.raisedAt) / 1000;
      const lift = since < 0.40 ? easing(Math.min(1, since / .40)) : since < .95 ? 1 : 1 - easing(Math.min(1, (since - .95) / .35));
      table.lamp.material.opacity = Math.min(1, Math.max(0, lift) * .92 + (team === leader || table === focus && sinceSale < 2 ? .56 : 0));
      table.people.forEach(person => person.animate(reducedMotion ? 0 : seconds, person === table.bidder ? Math.max(0, lift) : 0));
    }
    const callHeight = callCue === "twice" ? 1 : callCue === "once" ? .67 : 0;
    const callLift = callHeight * (reducedMotion ? 1 : easing(Math.min(1, Math.max(0, (now - callStarted) / 270))));
    const striking = sinceSale < .44 && !reducedMotion;
    const swing = striking ? easing(Math.min(1, sinceSale / .25)) * easing(Math.min(1, (.44 - sinceSale) / .19)) : 0;
    stage.auctioneer.animate(reducedMotion ? 0 : seconds, striking ? swing : callLift);
    stage.gavel.position.copy(gavelRest);
    if (striking) {
      stage.auctioneer.hand.getWorldPosition(gavelHand);
      stage.gavel.position.lerp(gavelHand, swing);
    }
    stage.gavel.rotation.x = -.85 * swing;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }

  return {
    configure,
    show(value) {
      if (visible === value) return;
      visible = value;
      if (visible) {
        resize();
        previousTime = null;
        frame = requestAnimationFrame(animate);
      } else {
        cancelAnimationFrame(frame);
      }
    },
    wide(value, reveal = false) { wide = value; revealing = reveal; },
    scoreboard(data) { stage.drawBoard(data); },
    lead(code) {
      if (code === leader) return;
      floorTables.get(leader)?.label.classList.remove("is-leading");
      leader = code;
      const desk = floorTables.get(code);
      spotlight.intensity = desk ? 420 : 0;
      spotlightRing.visible = Boolean(desk);
      spotlightBeam.visible = Boolean(desk);
      if (!desk) return;
      desk.label.classList.add("is-leading");
      spotlight.color.set(desk.color);
      spotlightBeam.material.uniforms.beamColor.value.set(desk.color);
      spotlightRing.material.color.set(desk.color);
      spotlight.target.position.copy(desk.table.position);
      spotlight.position.copy(desk.table.position);
      spotlight.position.y = 8;
      spotlightBeam.position.copy(desk.table.position);
      spotlightBeam.position.y = 4.03;
      spotlightRing.position.copy(desk.table.position);
      spotlightRing.position.y = .084;
    },
    call(cue) {
      if (cue === callCue) return;
      callCue = cue;
      callStarted = performance.now();
    },
    raise(code) {
      const table = floorTables.get(code);
      if (table) table.raisedAt = performance.now();
    },
    sold(team, featured) { sale = { team, featured, at: performance.now() }; },
    resetSale() { sale = null; callCue = null; },
    reduced(value) { reducedMotion = value; },
  };
}
