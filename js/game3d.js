(function () {
  "use strict";

  var mount = document.getElementById("gameMount");
  var ui = {
    menu: document.getElementById("menuPanel"),
    pause: document.getElementById("pausePanel"),
    result: document.getElementById("resultPanel"),
    height: document.getElementById("heightValue"),
    gems: document.getElementById("gemValue"),
    best: document.getElementById("bestValue"),
    boost: document.getElementById("boostFill"),
    difficulty: document.getElementById("difficultySelect"),
    resultEyebrow: document.getElementById("resultEyebrow"),
    resultTitle: document.getElementById("resultTitle"),
    resultStats: document.getElementById("resultStats")
  };

  var WORLD = {
    radius: 72,
    goalHeight: 1450,
    eyeHeight: 13,
    gravity: 118,
    jump: 104,
    springJump: 138,
    maxFall: 128,
    routeStep: 34,
    maxRouteMove: 28
  };

  var DIFFICULTY = {
    chill: { lavaSpeed: 4.8, routeStep: 31, name: "Chill" },
    normal: { lavaSpeed: 6.4, routeStep: 34, name: "Normal" },
    eruption: { lavaSpeed: 8.2, routeStep: 37, name: "Eruption" }
  };

  var PLATFORM = {
    stone: { color: 0xffb85a, top: 0xffdf78 },
    spring: { color: 0x29d8a1, top: 0x9bffcf },
    crumble: { color: 0xffd23f, top: 0xfff09d },
    drift: { color: 0x56c8ff, top: 0xc8f6ff },
    dash: { color: 0xff6fb7, top: 0xffb4dd }
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function distance2d(ax, az, bx, bz) {
    var x = ax - bx;
    var z = az - bz;
    return Math.sqrt(x * x + z * z);
  }

  function Random(seed) {
    this.seed = seed || 1234;
  }

  Random.prototype.next = function () {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  Random.prototype.range = function (min, max) {
    return min + (max - min) * this.next();
  };

  function Input() {
    this.keys = {};
    this.jumpQueued = false;
    this.pointerWanted = false;
    this.touch = {};
    this.bind();
  }

  Input.prototype.bind = function () {
    var self = this;
    window.addEventListener("keydown", function (event) {
      var key = event.key.toLowerCase();
      if (["w", "a", "s", "d", " ", "shift", "p", "arrowup", "arrowleft", "arrowright", "arrowdown"].indexOf(key) !== -1) {
        event.preventDefault();
      }
      if (key === " " || key === "arrowup") self.jumpQueued = true;
      if (key === "p") {
        if (game && game.mode === "playing") game.pause();
        else if (game && game.mode === "paused") game.resume();
      }
      self.keys[key] = true;
    });
    window.addEventListener("keyup", function (event) {
      self.keys[event.key.toLowerCase()] = false;
    });
    mount.addEventListener("click", function () {
      self.pointerWanted = true;
      requestPointer();
    });
    document.querySelectorAll("[data-touch]").forEach(function (button) {
      var action = button.dataset.touch;
      button.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        self.touch[action] = true;
        if (action === "jump") self.jumpQueued = true;
      });
      button.addEventListener("pointerup", function () { self.touch[action] = false; });
      button.addEventListener("pointercancel", function () { self.touch[action] = false; });
      button.addEventListener("pointerleave", function () { self.touch[action] = false; });
    });
  };

  Input.prototype.axis = function () {
    return {
      x: (this.keys.d || this.keys.arrowright || this.touch.right ? 1 : 0) - (this.keys.a || this.keys.arrowleft || this.touch.left ? 1 : 0),
      z: (this.keys.s || this.keys.arrowdown ? 1 : 0) - (this.keys.w || this.keys.arrowup ? 1 : 0)
    };
  };

  Input.prototype.consumeJump = function () {
    var queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  };

  Input.prototype.dashHeld = function () {
    return !!(this.keys.shift || this.touch.boost);
  };

  function Platform(data) {
    this.x = data.x;
    this.y = data.y;
    this.z = data.z;
    this.radius = data.radius;
    this.type = data.type;
    this.route = !!data.route;
    this.used = false;
    this.life = data.type === "crumble" ? 999 : Infinity;
    this.phase = data.phase || 0;
    this.baseX = data.x;
    this.baseZ = data.z;
    this.mesh = null;
    this.ring = null;
  }

  Platform.prototype.update = function (time, delta) {
    if (this.type === "drift") {
      this.x = this.baseX + Math.sin(time * 0.9 + this.phase) * 9;
      this.z = this.baseZ + Math.cos(time * 0.75 + this.phase) * 9;
      if (this.mesh) this.mesh.position.set(this.x, this.y, this.z);
      if (this.ring) this.ring.position.set(this.x, this.y + 1.8, this.z);
    }
    if (this.type === "crumble" && this.used) {
      this.life -= delta;
      if (this.mesh) {
        this.mesh.rotation.z = Math.sin(time * 18) * 0.04;
        this.mesh.position.y = this.y - (1.6 - this.life) * 1.6;
      }
    }
  };

  function Coin(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.collected = false;
    this.mesh = null;
  }

  function Particle(position, velocity, color, size, life) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
    this.mesh = null;
  }

  function Materials() {
    this.rock = new THREE.MeshLambertMaterial({ color: 0xff9652 });
    this.rockTop = new THREE.MeshLambertMaterial({ color: 0xffdd7a });
    this.darkRock = new THREE.MeshLambertMaterial({ color: 0x6e3567 });
    this.grass = new THREE.MeshLambertMaterial({ color: 0x4fd66d });
    this.sand = new THREE.MeshLambertMaterial({ color: 0xffdc83 });
    this.trunk = new THREE.MeshLambertMaterial({ color: 0x9b5c38 });
    this.leaf = new THREE.MeshLambertMaterial({ color: 0x3ccc66 });
    this.leafLight = new THREE.MeshLambertMaterial({ color: 0x76f08b });
    this.flowerPink = new THREE.MeshLambertMaterial({ color: 0xff78bf });
    this.flowerYellow = new THREE.MeshLambertMaterial({ color: 0xffe85e });
    this.water = new THREE.MeshBasicMaterial({ color: 0x55dcff, transparent: true, opacity: 0.74 });
    this.wallStripeA = new THREE.MeshLambertMaterial({ color: 0xc95f72 });
    this.wallStripeB = new THREE.MeshLambertMaterial({ color: 0xff9b58 });
    this.crystal = new THREE.MeshLambertMaterial({ color: 0x74f7ff, emissive: 0x173c54 });
    this.lava = new THREE.MeshBasicMaterial({ color: 0xff522e, transparent: true, opacity: 0.92 });
    this.lavaGlow = new THREE.MeshBasicMaterial({ color: 0xffc846, transparent: true, opacity: 0.48 });
    this.coin = new THREE.MeshLambertMaterial({ color: 0xffe24b, emissive: 0x5a3100 });
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72 });
  }

  function VolcanoGame(input) {
    this.input = input;
    this.mode = "menu";
    this.best = Number(localStorage.getItem("volcanoEscapeFirstPersonBest") || 0);
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.materials = null;
    this.clock = new THREE.Clock();
    this.platforms = [];
    this.coins = [];
    this.particles = [];
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.lavaY = -34;
    this.maxHeight = 0;
    this.coinCount = 0;
    this.grounded = true;
    this.coyote = 0.25;
    this.dash = 1;
    this.routeIndex = 0;
    this.route = [];
    this.difficulty = DIFFICULTY.normal;
    this.random = new Random(Date.now() >>> 0);
    this.lavaMesh = null;
    this.lavaGlowMesh = null;
    this.skyGate = null;
    this.initRenderer();
    this.initScene();
    this.updateUi();
    this.loop();
  }

  VolcanoGame.prototype.initRenderer = function () {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x6ac7ff);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2600);
    this.controls = new THREE.PointerLockControls(this.camera);
    this.controls.enabled = false;

    window.addEventListener("resize", this.resize.bind(this));
    document.addEventListener("pointerlockchange", this.onPointerLock.bind(this));
    document.addEventListener("mozpointerlockchange", this.onPointerLock.bind(this));
    document.addEventListener("webkitpointerlockchange", this.onPointerLock.bind(this));
  };

  VolcanoGame.prototype.initScene = function () {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8edcff, 90, 430);
    this.materials = new Materials();

    var hemi = new THREE.HemisphereLight(0xd8f7ff, 0x7b3b32, 0.82);
    this.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff2bd, 1.3);
    sun.position.set(-90, 180, 70);
    sun.castShadow = true;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 160;
    sun.shadow.camera.bottom = -80;
    this.scene.add(sun);

    this.scene.add(this.controls.getObject());
    this.buildWorldShell();
  };

  VolcanoGame.prototype.start = function (practice) {
    this.practice = !!practice;
    this.mode = "playing";
    this.difficulty = DIFFICULTY[ui.difficulty.value] || DIFFICULTY.normal;
    this.random = new Random(Date.now() >>> 0);
    this.resetGameObjects();
    this.generateRoute();
    this.controls.getObject().position.set(0, WORLD.eyeHeight + 3, 44);
    if (this.route[1]) {
      var yaw = Math.atan2(-this.route[1].x, -(this.route[1].z - 44));
      if (this.controls.setRotation) this.controls.setRotation(yaw, 0.14);
      else this.controls.getObject().rotation.y = yaw;
    }
    this.velocity.set(0, 0, 0);
    this.lavaY = -34;
    this.maxHeight = 0;
    this.coinCount = 0;
    this.grounded = false;
    this.coyote = 0;
    this.dash = 1;
    this.routeIndex = 0;
    ui.menu.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.result.classList.add("hidden");
    requestPointer();
    this.updateUi();
  };

  VolcanoGame.prototype.resetGameObjects = function () {
    var self = this;
    this.platforms.forEach(function (platform) {
      self.scene.remove(platform.mesh);
      if (platform.ring) self.scene.remove(platform.ring);
    });
    this.coins.forEach(function (coin) { self.scene.remove(coin.mesh); });
    this.particles.forEach(function (particle) { self.scene.remove(particle.mesh); });
    this.platforms = [];
    this.coins = [];
    this.particles = [];
    if (this.skyGate) this.scene.remove(this.skyGate);
  };

  VolcanoGame.prototype.buildWorldShell = function () {
    var ocean = new THREE.Mesh(
      new THREE.CylinderGeometry(650, 650, 5, 96),
      new THREE.MeshLambertMaterial({ color: 0x28b8d7 })
    );
    ocean.position.y = -44;
    ocean.receiveShadow = true;
    this.scene.add(ocean);

    var island = new THREE.Mesh(
      new THREE.CylinderGeometry(118, 144, 20, 24),
      this.materials.sand
    );
    island.position.y = -38;
    island.receiveShadow = true;
    island.castShadow = true;
    this.scene.add(island);

    var grass = new THREE.Mesh(
      new THREE.CylinderGeometry(105, 118, 7, 24),
      this.materials.grass
    );
    grass.position.y = -25;
    grass.receiveShadow = true;
    this.scene.add(grass);

    this.addIslandDetails();

    var shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(WORLD.radius + 18, WORLD.radius + 40, WORLD.goalHeight + 280, 32, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x9a4f78, side: THREE.BackSide })
    );
    shaft.position.y = WORLD.goalHeight / 2 + 70;
    this.scene.add(shaft);

    for (var i = 0; i < 34; i += 1) {
      var angle = i * Math.PI * 2 / 34;
      var height = this.random.range(90, WORLD.goalHeight + 170);
      var rib = new THREE.Mesh(
        new THREE.BoxGeometry(this.random.range(4, 10), this.random.range(70, 170), this.random.range(7, 16)),
        this.materials.darkRock
      );
      rib.position.set(Math.cos(angle) * (WORLD.radius + 8), height, Math.sin(angle) * (WORLD.radius + 8));
      rib.lookAt(new THREE.Vector3(0, height, 0));
      this.scene.add(rib);
    }

    this.addWallDetails();

    this.addPalm(-78, -24, 70, 1.3);
    this.addPalm(92, -24, -34, 1.15);
    this.addPalm(-108, -24, -68, 1);
    this.addClouds();

    this.lavaMesh = new THREE.Mesh(new THREE.CylinderGeometry(WORLD.radius + 6, WORLD.radius + 16, 5, 48), this.materials.lava);
    this.lavaGlowMesh = new THREE.Mesh(new THREE.CylinderGeometry(WORLD.radius + 12, WORLD.radius + 22, 2, 48), this.materials.lavaGlow);
    this.scene.add(this.lavaMesh);
    this.scene.add(this.lavaGlowMesh);
  };

  VolcanoGame.prototype.addIslandDetails = function () {
    for (var i = 0; i < 46; i += 1) {
      var angle = this.random.range(0, Math.PI * 2);
      var radius = this.random.range(42, 110);
      var stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.5, this.random.range(2.5, 5.5), 5),
        this.materials.leafLight
      );
      stem.position.set(Math.cos(angle) * radius, -17, Math.sin(angle) * radius);
      stem.rotation.z = this.random.range(-0.18, 0.18);
      this.scene.add(stem);

      if (i % 3 === 0) {
        var flower = new THREE.Mesh(
          new THREE.SphereGeometry(this.random.range(1.2, 2.1), 6, 4),
          i % 2 === 0 ? this.materials.flowerPink : this.materials.flowerYellow
        );
        flower.position.set(stem.position.x, -13.5, stem.position.z);
        this.scene.add(flower);
      }
    }
  };

  VolcanoGame.prototype.addWallDetails = function () {
    for (var i = 0; i < 22; i += 1) {
      var angle = i * Math.PI * 2 / 22 + 0.12;
      var height = this.random.range(80, WORLD.goalHeight + 120);
      var stripe = new THREE.Mesh(
        new THREE.BoxGeometry(this.random.range(16, 34), this.random.range(3, 7), 2.4),
        i % 2 === 0 ? this.materials.wallStripeA : this.materials.wallStripeB
      );
      stripe.position.set(Math.cos(angle) * (WORLD.radius + 1), height, Math.sin(angle) * (WORLD.radius + 1));
      stripe.lookAt(new THREE.Vector3(0, height, 0));
      this.scene.add(stripe);
    }

    for (var c = 0; c < 18; c += 1) {
      var crystalAngle = this.random.range(0, Math.PI * 2);
      var crystalHeight = this.random.range(70, WORLD.goalHeight + 80);
      var crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(this.random.range(2.2, 4.4), 0),
        this.materials.crystal
      );
      crystal.position.set(Math.cos(crystalAngle) * (WORLD.radius + 2), crystalHeight, Math.sin(crystalAngle) * (WORLD.radius + 2));
      crystal.lookAt(new THREE.Vector3(0, crystalHeight, 0));
      this.scene.add(crystal);
    }

    for (var w = 0; w < 5; w += 1) {
      var waterAngle = w * Math.PI * 2 / 5 + 0.45;
      var water = new THREE.Mesh(
        new THREE.PlaneGeometry(9, this.random.range(160, 280), 1, 1),
        this.materials.water
      );
      water.position.set(Math.cos(waterAngle) * (WORLD.radius + 0.6), this.random.range(250, WORLD.goalHeight), Math.sin(waterAngle) * (WORLD.radius + 0.6));
      water.lookAt(new THREE.Vector3(0, water.position.y, 0));
      this.scene.add(water);
    }
  };

  VolcanoGame.prototype.addPalm = function (x, y, z, scale) {
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * scale, 3.1 * scale, 34 * scale, 8), this.materials.trunk);
    trunk.position.set(x, y + 17 * scale, z);
    trunk.rotation.z = 0.12;
    trunk.castShadow = true;
    this.scene.add(trunk);
    for (var i = 0; i < 7; i += 1) {
      var leaf = new THREE.Mesh(new THREE.BoxGeometry(7 * scale, 1.2 * scale, 25 * scale), this.materials.leaf);
      leaf.position.set(x, y + 34 * scale, z);
      leaf.rotation.y = i * Math.PI * 2 / 7;
      leaf.rotation.x = -0.35;
      leaf.translateZ(11 * scale);
      leaf.castShadow = true;
      this.scene.add(leaf);
    }
  };

  VolcanoGame.prototype.addClouds = function () {
    for (var i = 0; i < 24; i += 1) {
      var group = new THREE.Group();
      var angle = this.random.range(0, Math.PI * 2);
      var radius = this.random.range(140, 360);
      var height = this.random.range(140, WORLD.goalHeight + 300);
      group.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      for (var puff = 0; puff < 4; puff += 1) {
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(this.random.range(5, 12), 10, 8), this.materials.white);
        mesh.position.set(this.random.range(-11, 11), this.random.range(-2, 4), this.random.range(-7, 7));
        group.add(mesh);
      }
      this.scene.add(group);
    }
  };

  VolcanoGame.prototype.generateRoute = function () {
    var route = [
      { x: 0, y: 0, z: 44 },
      { x: 0, y: 18, z: 20 },
      { x: -18, y: 44, z: -4 },
      { x: 11, y: 74, z: -26 },
      { x: 31, y: 106, z: -6 }
    ];
    var angle = Math.atan2(route[route.length - 1].z, route[route.length - 1].x);
    var difficultyStep = this.difficulty.routeStep;

    while (route[route.length - 1].y < WORLD.goalHeight) {
      var previous = route[route.length - 1];
      angle += this.random.range(-0.7, 0.85);
      var move = this.random.range(14, WORLD.maxRouteMove);
      var radius = clamp(Math.sqrt(previous.x * previous.x + previous.z * previous.z) + this.random.range(-12, 12), 18, WORLD.radius - 16);
      var x = Math.cos(angle) * radius;
      var z = Math.sin(angle) * radius;
      if (distance2d(previous.x, previous.z, x, z) > move) {
        var dx = x - previous.x;
        var dz = z - previous.z;
        var length = Math.sqrt(dx * dx + dz * dz);
        x = previous.x + dx / length * move;
        z = previous.z + dz / length * move;
      }
      route.push({
        x: x,
        y: previous.y + this.random.range(difficultyStep - 7, difficultyStep + 5),
        z: z
      });
    }
    this.route = route;

    for (var i = 0; i < route.length; i += 1) {
      var type = "stone";
      if (i > 5 && i % 9 === 0) type = "spring";
      else if (i > 7 && i % 11 === 0) type = "drift";
      else if (i > 12 && i % 13 === 0) type = "crumble";
      else if (i > 16 && i % 17 === 0) type = "dash";

      this.addPlatform(new Platform({
        x: route[i].x,
        y: route[i].y,
        z: route[i].z,
        radius: i === 0 ? 23 : 15,
        type: type,
        route: true,
        phase: this.random.range(0, 10)
      }));

      if (i > 0 && i % 2 === 0) {
        this.addCoin(route[i].x, route[i].y + 16, route[i].z);
      }

      if (i > 3 && i % 4 === 0) {
        var sideAngle = Math.atan2(route[i].z, route[i].x) + this.random.range(-1.2, 1.2);
        var sideRadius = clamp(Math.sqrt(route[i].x * route[i].x + route[i].z * route[i].z) + this.random.range(16, 28), 18, WORLD.radius - 12);
        this.addPlatform(new Platform({
          x: Math.cos(sideAngle) * sideRadius,
          y: route[i].y + this.random.range(-5, 8),
          z: Math.sin(sideAngle) * sideRadius,
          radius: 11,
          type: this.random.next() > 0.65 ? "dash" : "stone",
          route: false,
          phase: this.random.range(0, 10)
        }));
      }
    }

    this.skyGate = this.createSkyGate();
    this.skyGate.position.set(0, WORLD.goalHeight + 48, 0);
    this.scene.add(this.skyGate);
  };

  VolcanoGame.prototype.addPlatform = function (platform) {
    var colors = PLATFORM[platform.type];
    var material = new THREE.MeshLambertMaterial({ color: colors.color });
    var topMaterial = new THREE.MeshLambertMaterial({ color: colors.top });
    var base = new THREE.Mesh(new THREE.CylinderGeometry(platform.radius, platform.radius + 3, 7, 12), material);
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(platform.radius * 0.92, platform.radius, 2, 12), topMaterial);
    var group = new THREE.Group();
    base.position.y = -3.5;
    cap.position.y = 1;
    base.castShadow = true;
    base.receiveShadow = true;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(base);
    group.add(cap);

    this.decoratePlatform(group, platform);

    group.position.set(platform.x, platform.y, platform.z);
    group.castShadow = true;
    group.receiveShadow = true;
    platform.mesh = group;

    if (platform.route) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(platform.radius * 0.48, 0.24, 6, 24),
        new THREE.MeshBasicMaterial({
          color: platform.type === "stone" ? 0xfff0a6 : colors.top,
          transparent: true,
          opacity: 0.78
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(platform.x, platform.y + 3.4, platform.z);
      platform.ring = ring;
      this.scene.add(ring);
    }

    this.platforms.push(platform);
    this.scene.add(group);
  };

  VolcanoGame.prototype.decoratePlatform = function (group, platform) {
    var colors = PLATFORM[platform.type];
    var marker = new THREE.Mesh(
      new THREE.CylinderGeometry(platform.radius * 0.34, platform.radius * 0.38, 0.7, 12),
      new THREE.MeshBasicMaterial({ color: colors.top })
    );
    marker.position.y = 2.6;
    group.add(marker);

    if (platform.type === "stone" || platform.type === "drift") {
      for (var i = 0; i < 5; i += 1) {
        var angle = i * Math.PI * 2 / 5 + platform.phase;
        var tuft = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4.5, 5), this.materials.leafLight);
        tuft.position.set(Math.cos(angle) * platform.radius * 0.62, 4.1, Math.sin(angle) * platform.radius * 0.62);
        tuft.rotation.z = this.random.range(-0.2, 0.2);
        group.add(tuft);
      }
    }

    if (platform.type === "spring") {
      for (var ring = 0; ring < 3; ring += 1) {
        var springRing = new THREE.Mesh(
          new THREE.TorusGeometry(platform.radius * (0.26 + ring * 0.11), 0.36, 6, 18),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        springRing.rotation.x = Math.PI / 2;
        springRing.position.y = 3.8 + ring * 1.4;
        group.add(springRing);
      }
    }

    if (platform.type === "crumble") {
      for (var crack = 0; crack < 4; crack += 1) {
        var line = new THREE.Mesh(
          new THREE.BoxGeometry(platform.radius * 0.48, 0.25, 0.55),
          new THREE.MeshBasicMaterial({ color: 0x7a4938 })
        );
        line.position.y = 3;
        line.rotation.y = crack * Math.PI / 4 + platform.phase;
        group.add(line);
      }
    }

    if (platform.type === "dash") {
      var arrow = new THREE.Mesh(
        new THREE.ConeGeometry(3.2, 9, 3),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      arrow.position.y = 6;
      arrow.rotation.x = Math.PI / 2;
      group.add(arrow);
    }
  };

  VolcanoGame.prototype.addCoin = function (x, y, z) {
    var coin = new Coin(x, y, z);
    coin.mesh = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.75, 8, 18), this.materials.coin);
    coin.mesh.position.set(x, y, z);
    coin.mesh.castShadow = true;
    this.coins.push(coin);
    this.scene.add(coin.mesh);
  };

  VolcanoGame.prototype.createSkyGate = function () {
    var group = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: 0xffed72 });
    var sideA = new THREE.Mesh(new THREE.BoxGeometry(8, 48, 8), mat);
    var sideB = sideA.clone();
    var top = new THREE.Mesh(new THREE.BoxGeometry(62, 8, 8), mat);
    sideA.position.x = -28;
    sideB.position.x = 28;
    top.position.y = 24;
    group.add(sideA);
    group.add(sideB);
    group.add(top);
    return group;
  };

  VolcanoGame.prototype.update = function (delta, time) {
    if (this.mode !== "playing") return;
    delta = Math.min(delta, 1 / 30);
    this.updateMovement(delta);
    this.updatePlatforms(delta, time);
    this.updateCoins(delta, time);
    this.updateLava(delta, time);
    this.updateParticles(delta);
    this.checkEnd();
    this.updateUi();
  };

  VolcanoGame.prototype.updateMovement = function (delta) {
    var object = this.controls.getObject();
    var axis = this.input.axis();
    var speed = this.input.dashHeld() && this.dash > 0 ? 76 : 50;
    var acceleration = this.grounded ? 11 : 6.5;
    var previousY = object.position.y - WORLD.eyeHeight;

    var yaw = object.rotation.y;
    this.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    var desiredX = this.forward.x * -axis.z + this.right.x * axis.x;
    var desiredZ = this.forward.z * -axis.z + this.right.z * axis.x;
    var desiredLength = Math.sqrt(desiredX * desiredX + desiredZ * desiredZ);
    if (desiredLength > 0) {
      desiredX /= desiredLength;
      desiredZ /= desiredLength;
    }

    this.velocity.x += (desiredX * speed - this.velocity.x) * acceleration * delta;
    this.velocity.z += (desiredZ * speed - this.velocity.z) * acceleration * delta;
    if (this.input.dashHeld() && desiredLength > 0 && this.dash > 0) {
      this.dash = Math.max(0, this.dash - delta * 0.36);
      this.spawnParticle(object.position, 0x98ffd7, 2);
    } else {
      this.dash = Math.min(1, this.dash + delta * 0.14);
    }

    this.coyote = this.grounded ? 0.13 : Math.max(0, this.coyote - delta);
    if (this.input.consumeJump() && this.coyote > 0) {
      this.velocity.y = WORLD.jump;
      this.grounded = false;
      this.coyote = 0;
      this.spawnBurst(object.position.x, object.position.y - WORLD.eyeHeight, object.position.z, 0xfff0a6, 10);
    }

    this.velocity.y -= WORLD.gravity * delta;
    this.velocity.y = Math.max(this.velocity.y, -WORLD.maxFall);
    object.position.x += this.velocity.x * delta;
    object.position.y += this.velocity.y * delta;
    object.position.z += this.velocity.z * delta;

    var radial = Math.sqrt(object.position.x * object.position.x + object.position.z * object.position.z);
    if (radial > WORLD.radius - 3) {
      object.position.x = object.position.x / radial * (WORLD.radius - 3);
      object.position.z = object.position.z / radial * (WORLD.radius - 3);
      this.velocity.x *= -0.18;
      this.velocity.z *= -0.18;
    }

    this.grounded = false;
    this.resolvePlatformLandings(previousY);
  };

  VolcanoGame.prototype.resolvePlatformLandings = function (previousFeetY) {
    var object = this.controls.getObject();
    var feetY = object.position.y - WORLD.eyeHeight;
    var best = null;
    for (var i = 0; i < this.platforms.length; i += 1) {
      var platform = this.platforms[i];
      if (platform.type === "crumble" && platform.life <= 0) continue;
      var top = platform.y + 2.4;
      var closeY = previousFeetY >= top && feetY <= top + 0.8 && this.velocity.y <= 0;
      var closeXZ = distance2d(object.position.x, object.position.z, platform.x, platform.z) <= platform.radius + 2.5;
      if (closeY && closeXZ) best = platform;
    }

    if (!best) return;
    object.position.y = best.y + 2.4 + WORLD.eyeHeight;
    this.velocity.y = 0;
    this.grounded = true;
    this.routeIndex = Math.max(this.routeIndex, this.platforms.indexOf(best));

    if (best.type === "spring") {
      this.velocity.y = WORLD.springJump;
      this.grounded = false;
      this.spawnBurst(best.x, best.y + 3, best.z, 0x7dffd2, 18);
    } else if (best.type === "dash") {
      this.dash = 1;
      if (!best.used) this.spawnBurst(best.x, best.y + 3, best.z, 0xff9bd2, 15);
      best.used = true;
    } else if (best.type === "crumble") {
      best.used = true;
      best.life = Math.min(best.life, 1.6);
    }
  };

  VolcanoGame.prototype.updatePlatforms = function (delta, time) {
    for (var i = 0; i < this.platforms.length; i += 1) {
      this.platforms[i].update(time, delta);
    }
  };

  VolcanoGame.prototype.updateCoins = function (delta, time) {
    var object = this.controls.getObject();
    for (var i = 0; i < this.coins.length; i += 1) {
      var coin = this.coins[i];
      if (coin.collected) continue;
      coin.mesh.rotation.y += delta * 5.5;
      coin.mesh.position.y = coin.y + Math.sin(time * 3 + i) * 1.2;
      if (distance2d(object.position.x, object.position.z, coin.x, coin.z) < 7 && Math.abs(object.position.y - WORLD.eyeHeight - coin.y) < 13) {
        coin.collected = true;
        coin.mesh.visible = false;
        this.coinCount += 1;
        this.dash = Math.min(1, this.dash + 0.22);
        this.spawnBurst(coin.x, coin.y, coin.z, 0xffe24b, 12);
      }
    }
  };

  VolcanoGame.prototype.updateLava = function (delta, time) {
    var object = this.controls.getObject();
    var speed = this.practice ? this.difficulty.lavaSpeed * 0.55 : this.difficulty.lavaSpeed;
    var catchup = Math.max(0, (object.position.y - WORLD.eyeHeight - this.lavaY - 210) * 0.018);
    this.lavaY += (speed + catchup) * delta;
    this.lavaMesh.position.y = this.lavaY + Math.sin(time * 3.5) * 0.9;
    this.lavaGlowMesh.position.y = this.lavaY + 4;
    this.lavaGlowMesh.scale.setScalar(1 + Math.sin(time * 5) * 0.015);
    if (Math.random() < 0.28) {
      var angle = Math.random() * Math.PI * 2;
      var radius = Math.random() * (WORLD.radius - 10);
      this.spawnParticle(new THREE.Vector3(Math.cos(angle) * radius, this.lavaY + 3, Math.sin(angle) * radius), 0xffd044, 1);
    }
  };

  VolcanoGame.prototype.updateParticles = function (delta) {
    for (var i = this.particles.length - 1; i >= 0; i -= 1) {
      var particle = this.particles[i];
      particle.life -= delta;
      particle.velocity.y -= 26 * delta;
      particle.position.add(particle.velocity.clone().multiplyScalar(delta));
      particle.mesh.position.copy(particle.position);
      particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
  };

  VolcanoGame.prototype.spawnParticle = function (origin, color, count) {
    for (var i = 0; i < count; i += 1) {
      this.spawnOneParticle(origin.x, origin.y, origin.z, color, 1.2 + Math.random() * 1.4);
    }
  };

  VolcanoGame.prototype.spawnBurst = function (x, y, z, color, count) {
    for (var i = 0; i < count; i += 1) {
      this.spawnOneParticle(x, y, z, color, 1.8 + Math.random() * 2.2);
    }
  };

  VolcanoGame.prototype.spawnOneParticle = function (x, y, z, color, size) {
    var velocity = new THREE.Vector3(Math.random() * 18 - 9, Math.random() * 20 + 6, Math.random() * 18 - 9);
    var particle = new Particle(new THREE.Vector3(x, y, z), velocity, color, size, 0.45 + Math.random() * 0.4);
    particle.mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1 })
    );
    particle.mesh.position.copy(particle.position);
    this.particles.push(particle);
    this.scene.add(particle.mesh);
  };

  VolcanoGame.prototype.checkEnd = function () {
    var object = this.controls.getObject();
    var feetY = object.position.y - WORLD.eyeHeight;
    this.maxHeight = Math.max(this.maxHeight, Math.max(0, Math.floor(feetY)));
    if (feetY <= this.lavaY + 5) {
      this.end(false);
    } else if (feetY >= WORLD.goalHeight + 24) {
      this.end(true);
    }
  };

  VolcanoGame.prototype.end = function (won) {
    if (this.mode !== "playing") return;
    this.mode = "ended";
    exitPointer();
    if (this.maxHeight > this.best) {
      this.best = this.maxHeight;
      localStorage.setItem("volcanoEscapeFirstPersonBest", String(this.best));
    }
    ui.resultEyebrow.textContent = won ? "Escaped" : "Run Over";
    ui.resultTitle.textContent = won ? "You cleared the island volcano." : "The lava caught you.";
    ui.resultStats.textContent = "Height " + this.maxHeight + "m - Coins " + this.coinCount + " - " + this.difficulty.name;
    ui.result.classList.remove("hidden");
  };

  VolcanoGame.prototype.pause = function () {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    exitPointer();
    ui.pause.classList.remove("hidden");
  };

  VolcanoGame.prototype.resume = function () {
    if (this.mode !== "paused") return;
    this.mode = "playing";
    ui.pause.classList.add("hidden");
    requestPointer();
  };

  VolcanoGame.prototype.showMenu = function () {
    this.mode = "menu";
    exitPointer();
    ui.result.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.menu.classList.remove("hidden");
  };

  VolcanoGame.prototype.updateUi = function () {
    ui.height.textContent = this.maxHeight + "m";
    ui.gems.textContent = String(this.coinCount);
    ui.best.textContent = this.best + "m";
    ui.boost.style.transform = "scaleX(" + this.dash + ")";
  };

  VolcanoGame.prototype.onPointerLock = function () {
    var locked = document.pointerLockElement === mount ||
      document.mozPointerLockElement === mount ||
      document.webkitPointerLockElement === mount;
    this.controls.enabled = locked && this.mode === "playing";
    if (!locked && this.mode === "playing") this.pause();
  };

  VolcanoGame.prototype.resize = function () {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  VolcanoGame.prototype.loop = function () {
    var self = this;
    requestAnimationFrame(function () { self.loop(); });
    var delta = this.clock.getDelta();
    var time = this.clock.elapsedTime;
    this.update(delta, time);
    this.renderer.render(this.scene, this.camera);
  };

  function requestPointer() {
    var request = mount.requestPointerLock || mount.mozRequestPointerLock || mount.webkitRequestPointerLock;
    if (request) request.call(mount);
  }

  function exitPointer() {
    var exit = document.exitPointerLock || document.mozExitPointerLock || document.webkitExitPointerLock;
    if (exit) exit.call(document);
  }

  var input = new Input();
  var game = new VolcanoGame(input);

  document.getElementById("playButton").addEventListener("click", function () { game.start(false); });
  document.getElementById("practiceButton").addEventListener("click", function () { game.start(true); });
  document.getElementById("resumeButton").addEventListener("click", function () { game.resume(); });
  document.getElementById("restartPauseButton").addEventListener("click", function () { game.start(game.practice); });
  document.getElementById("restartButton").addEventListener("click", function () { game.start(game.practice); });
  document.getElementById("menuButton").addEventListener("click", function () { game.showMenu(); });
}());
