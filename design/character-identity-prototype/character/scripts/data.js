/* Identity Graph — seed data + localStorage helpers
   All character/zone state lives in localStorage, key: ig:state:v1
*/
(function () {
  const KEY = "ig:state:generated-dog:v2";

  // Curated Unsplash portrait photo IDs — reliable, evergreen.
  // Used as both source and zone fillers for the demo.
  const U = (id, w = 700) =>
    `https://images.unsplash.com/${id}?w=${w}&q=80&auto=format&fit=crop`;

  const ZONE_DEFS = [
    { id: "full_front",  group: "body",  label: "Full Front",  aspect: "3 / 4" },
    { id: "full_side",   group: "body",  label: "Full Side",   aspect: "3 / 4" },
    { id: "full_back",   group: "body",  label: "Full Back",   aspect: "3 / 4" },
    { id: "half_body",   group: "body",  label: "Half Body",   aspect: "3 / 4" },
    { id: "face_front",  group: "face",  label: "Face Front",  aspect: "1 / 1" },
    { id: "face_left",   group: "face",  label: "Face Left",   aspect: "1 / 1" },
    { id: "face_right",  group: "face",  label: "Face Right",  aspect: "1 / 1" },
    { id: "outfit",      group: "items", label: "Coat Detail", aspect: "1 / 1" },
    { id: "shoes",       group: "items", label: "Paws",        aspect: "1 / 1" },
    { id: "bag",         group: "items", label: "Toy Prop",    aspect: "1 / 1" },
  ];

  const SET_USE_TARGETS = [
    { id: "profile", label: "Profile", icon: "user" },
    { id: "product", label: "Product Visuals", icon: "screen" },
    { id: "deck", label: "Presentations", icon: "slide" },
    { id: "social", label: "Social Media", icon: "phone" },
    { id: "lookbook", label: "Lookbooks", icon: "book" },
  ];

  const SCENE5_PROMPT = [
    "Korean TV baseball broadcast fan-cam still, realistic 4:3 landscape, excited post-hit crowd reaction.",
    "Preserve the same young woman from the two woman references: fair skin, soft oval-heart face with narrow V jaw, large round-almond brown eyes, precise eyeliner and long lashes, defined natural brows, small straight nose, soft pink lips, auburn/dark-brown voluminous side-parted layered hair, delicate glam makeup.",
    "She wears a generic red-and-cream baseball scarf and jersey with no brand logos and no real team marks.",
    "She is cheering after a hit while holding thunder sticks away from the dog.",
    "Preserve the dog from the reference: small fluffy white toy-breed dog, round puffy face, dark round eyes, black nose, cream-white curly coat, small body.",
    "The dog is calm in her lap, face visible, paws natural.",
    "Broadcast crop keeps her face large enough for identity likeness.",
    "Add only fictional Korean broadcast graphics: top-left scoreboard HUD with 서울 레드윙스 5 and 인천 크림스 4, top-right generic 스포츠 LIVE, bottom Korean lower-third reading 레드윙스 팬 환호 장면.",
    "Natural hands and paws, correct fingers, correct limbs, no malformed anatomy."
  ].join(" ");

  const SCENE5_NEGATIVE = [
    "No real leagues, no real team names, no broadcasters, no sponsors, no watermarks, no brand logos.",
    "Do not show KBO, 한화, 두산, LG, 롯데, 삼성, 키움, SSG, KT, NC, KIA, MBC, SBS, KBS, SPOTV, TVING, Coupang, Nike, Adidas.",
    "Do not invent a different woman, do not change her face shape, do not make the dog a different breed, do not hide the dog face.",
    "No extra fingers, no extra limbs, no fused hands, no warped paws, no unreadable logo-like text."
  ].join(" ");

  // ---- seed characters
  const seed = [
    {
      id: "ID-A01",
      name: "Mira Chen",
      tagline: "Calm. Empathetic. Detail-oriented.",
      source: U("photo-1544005313-94ddf0286df2", 900),
      spec: {
        age: "Late 20s",
        ethnicity: "East Asian",
        occupation: "Product Designer",
        personality: "Calm, empathetic, detail-oriented",
        hair: "Black bob, shoulder length, soft side part",
        eyes: "Dark brown",
        build: "Slim, average height",
        expression: "Calm, approachable",
        wardrobe: "Beige trench coat, white knit top, charcoal trousers, white sneakers",
        accessories: "Slim silver watch, tan leather crossbody bag, small gold earrings",
        style: "Minimal, modern, professional",
        lighting: "Soft studio light",
        background: "Neutral gray",
      },
      identityLock: true,
      prompt:
        "Photorealistic studio portrait and full body views of the same East Asian woman, late 20s, product designer. Black shoulder-length bob with soft side part. Calm expression. Wearing beige trench coat over white knit top, charcoal trousers, white sneakers. Tan leather crossbody bag, slim silver watch, small gold earrings. Neutral gray background, soft studio light.",
      setUse: ["profile", "product", "deck", "social", "lookbook"],
      zones: {
        full_front: ver([U("photo-1544005313-94ddf0286df2"), U("photo-1531123897727-8f129e1688ce")], 0),
        full_side:  ver([U("photo-1531123897727-8f129e1688ce")], 0),
        full_back:  ver([U("photo-1542327897-d73f4005b533")], 0),
        half_body:  ver([U("photo-1544005313-94ddf0286df2"), U("photo-1554151228-14d9def656e4")], 0),
        face_front: ver([U("photo-1544005313-94ddf0286df2")], 0),
        face_left:  ver([U("photo-1438761681033-6461ffad8d80")], 0),
        face_right: ver([U("photo-1517841905240-472988babdf9")], 0),
        outfit:     ver([U("photo-1539109136881-3be0616acf4b")], 0),
        shoes:      ver([U("photo-1542291026-7eec264c27ff")], 0),
        bag:        ver([U("photo-1591561954557-26941169b49e")], 0),
      },
    },
    {
      id: "ID-A02",
      name: "Marcus Vale",
      tagline: "Confident. Editorial. Architectural.",
      source: U("photo-1507003211169-0a1dd7228f2d", 900),
      spec: {
        age: "Early 30s",
        ethnicity: "Black",
        occupation: "Creative Director",
        personality: "Confident, decisive, considered",
        hair: "Close fade, sharp lineup",
        eyes: "Hazel",
        build: "Tall, athletic",
        expression: "Composed, intent",
        wardrobe: "Black wool turtleneck, ink-black wide trousers, leather chelsea boots",
        accessories: "Steel chronograph, thin silver chain",
        style: "Architectural, monochrome, editorial",
        lighting: "Hard side key, soft fill",
        background: "Warm graphite",
      },
      identityLock: true,
      prompt:
        "Editorial portrait of Black man in early 30s, creative director. Close fade with sharp lineup. Black wool turtleneck, wide ink-black trousers, leather chelsea boots. Steel chronograph watch. Hard side-key studio lighting, warm graphite seamless backdrop.",
      setUse: ["profile", "deck", "lookbook"],
      zones: {
        full_front: ver([U("photo-1507003211169-0a1dd7228f2d")], 0),
        full_side:  ver([U("photo-1492562080023-ab3db95bfbce")], 0),
        full_back:  empty(),
        half_body:  ver([U("photo-1500648767791-00dcc994a43e")], 0),
        face_front: ver([U("photo-1507003211169-0a1dd7228f2d")], 0),
        face_left:  ver([U("photo-1500648767791-00dcc994a43e")], 0),
        face_right: empty(),
        outfit:     ver([U("photo-1490578474895-699cd4e2cf59")], 0),
        shoes:      ver([U("photo-1449505278894-297fdb3edbc1")], 0),
        bag:        empty(),
      },
    },
    {
      id: "ID-A03",
      name: "Elena Roth",
      tagline: "Soft. Editorial. Sun-bleached.",
      source: U("photo-1487412720507-e7ab37603c6f", 900),
      spec: {
        age: "Mid 20s",
        ethnicity: "Mixed European",
        occupation: "Stylist",
        personality: "Warm, curious, soft-spoken",
        hair: "Long sandy waves, center part",
        eyes: "Pale green",
        build: "Petite",
        expression: "Soft smile",
        wardrobe: "Cream linen blouse, faded denim, woven loafers",
        accessories: "Tortoise sunglasses, small hoops, raffia tote",
        style: "Sun-bleached editorial",
        lighting: "Golden hour natural",
        background: "Linen wall",
      },
      identityLock: true,
      prompt:
        "Sun-bleached editorial portrait of mixed European woman in mid 20s, stylist. Long sandy waves, center part. Cream linen blouse over faded denim, woven loafers. Tortoise sunglasses, small hoops, raffia tote. Golden hour natural light, warm linen wall background.",
      setUse: ["profile", "lookbook", "social"],
      zones: {
        full_front: ver([U("photo-1487412720507-e7ab37603c6f")], 0),
        full_side:  empty(),
        full_back:  empty(),
        half_body:  ver([U("photo-1524504388940-b1c1722653e1")], 0),
        face_front: ver([U("photo-1487412720507-e7ab37603c6f")], 0),
        face_left:  ver([U("photo-1524504388940-b1c1722653e1")], 0),
        face_right: empty(),
        outfit:     ver([U("photo-1490481651871-ab68de25d43d")], 0),
        shoes:      empty(),
        bag:        empty(),
      },
    },
    {
      id: "ID-A04",
      name: "Kenji Otsu",
      tagline: "Quiet. Crafted. Workwear.",
      source: U("photo-1492562080023-ab3db95bfbce", 900),
      spec: {
        age: "Mid 30s",
        ethnicity: "Japanese",
        occupation: "Craftsman / Maker",
        personality: "Quiet, focused, precise",
        hair: "Short black, side swept",
        eyes: "Dark brown",
        build: "Lean, average",
        expression: "Contemplative",
        wardrobe: "Indigo selvedge denim jacket, ecru tee, raw selvedge jeans, work boots",
        accessories: "Field watch, leather card case",
        style: "Crafted, workwear, quiet luxury",
        lighting: "Soft window light",
        background: "Concrete wall",
      },
      identityLock: false,
      prompt:
        "Quiet workwear portrait of Japanese man, mid 30s, craftsman. Short black hair side swept. Indigo selvedge denim jacket over ecru tee, raw denim jeans, leather work boots. Field watch. Soft window side-light, concrete wall background.",
      setUse: ["profile", "lookbook"],
      zones: {
        full_front: ver([U("photo-1492562080023-ab3db95bfbce")], 0),
        full_side:  empty(),
        full_back:  empty(),
        half_body:  ver([U("photo-1500648767791-00dcc994a43e")], 0),
        face_front: ver([U("photo-1492562080023-ab3db95bfbce")], 0),
        face_left:  empty(),
        face_right: empty(),
        outfit:     ver([U("photo-1542060748-10c28b62716f")], 0),
        shoes:      ver([U("photo-1520975916090-3105956dac38")], 0),
        bag:        empty(),
      },
    },
    {
      id: "ID-D01",
      name: "Duoduo",
      tagline: "Cloud-soft. Mischievous. Inquisitive.",
      source: "assets/duoduo/card.jpg",
      sourcePos: "center center",
      spec: {
        age: "3 years",
        ethnicity: "Bichon Frise",
        occupation: "Resident floof",
        personality: "Curious, mischievous, affectionate",
        hair: "Pure white, dense curly coat, fully groomed round head",
        eyes: "Round black, soulful",
        build: "Toy build, ~5kg",
        expression: "Pink tongue out, mid-pant smile",
        wardrobe: "Au naturel — fresh groom",
        accessories: "Optional pastel bandana",
        style: "Studio pet portrait, warm bokeh",
        lighting: "Warm window key, soft fill, gentle rim",
        background: "Plant-filled patio, terracotta floor, blurred",
      },
      identityLock: true,
      prompt:
        "Photorealistic studio + lifestyle portraits of the SAME small Bichon Frise: pure white fluffy coat freshly groomed into a perfectly round head, round black eyes, black nose, pink tongue. Preserve face proportions, fur texture and stance across angles. Soft warm light, plant-and-terracotta indoor patio. No human in frame.",
      setUse: ["profile", "social", "lookbook"],
      zones: {
        full_front: ver(["assets/duoduo/full_front.jpg"], 0),
        full_side:  empty(),
        full_back:  empty(),
        half_body:  ver(["assets/duoduo/half_body.jpg"], 0),
        face_front: ver(["assets/duoduo/face_front.jpg"], 0),
        face_left:  empty(),
        face_right: empty(),
        outfit:     empty(),
        shoes:      empty(),
        bag:        empty(),
      },
    },
    {
      id: "ID-S05",
      name: "Scene 5 Fan-Cam Pair",
      tagline: "Identity-locked baseball fan scene with calm toy dog.",
      source: "assets/reference-dog/source.jpg",
      sourcePos: "center center",
      spec: {
        age: "Young adult",
        ethnicity: "Reference-preserved woman; do not redesign or ethnicity-swap",
        occupation: "Baseball fan-cam subject",
        personality: "Excited, glamorous, protective of the dog",
        hair: "Auburn to dark-brown voluminous side-parted layered hair",
        eyes: "Large round-almond brown eyes, precise eyeliner, long lashes",
        build: "Petite to average, broadcast close crop",
        expression: "Excited post-hit cheer, face clear enough for likeness",
        wardrobe: "Generic red-and-cream baseball scarf and jersey, no real team marks",
        accessories: "Thunder sticks held away from the dog; no sponsor logos",
        style: "Realistic Korean TV baseball fan-cam still, 4:3 landscape",
        lighting: "Bright stadium broadcast lighting, natural crowd ambience",
        background: "Crowded baseball stands with fictional Korean broadcast HUD",
      },
      identityLock: true,
      prompt: SCENE5_PROMPT,
      setUse: ["social", "deck"],
      generation: {
        useCase: "identity-preserve",
        assetType: "Korean TV baseball broadcast fan-cam still, 4:3 landscape",
        renderRoute: "Generate from reference stack, then edit/refine selected still",
        references: [
          {
            id: "woman-left",
            label: "Woman ref · left",
            role: "Primary face identity",
            status: "Needed from attached contact sheet; represented here by written identity contract",
            lock: "Soft oval-heart face, narrow V jaw, large brown round-almond eyes, eyeliner, long lashes, defined brows, small straight nose, soft pink lips"
          },
          {
            id: "woman-middle",
            label: "Woman ref · middle",
            role: "Secondary face and hair confirmation",
            status: "Needed from attached contact sheet; represented here by written identity contract",
            lock: "Auburn/dark-brown voluminous side-parted layered hair, fair skin, delicate glam makeup"
          },
          {
            id: "dog-right",
            label: "Dog ref · downloaded",
            role: "Pet identity",
            status: "Loaded from provided URL",
            url: "assets/reference-dog/source.jpg",
            lock: "Small fluffy white toy-breed dog, round puffy face, dark round eyes, black nose, cream-white curly coat, small body"
          }
        ],
        identityContract: [
          "Preserve the same young woman from both woman references, not a new generic Asian woman.",
          "Keep fair skin, soft oval-heart face, narrow V jaw, large round-almond brown eyes, precise eyeliner, long lashes, defined natural brows, small straight nose, soft pink lips.",
          "Keep auburn/dark-brown voluminous side-parted layered hair and delicate glam makeup.",
          "Broadcast framing must keep her face large enough to judge identity likeness."
        ],
        dogContract: [
          "Use the downloaded dog reference as the dog identity anchor.",
          "Keep a small fluffy white toy-breed body, round puffy face, dark eyes, black nose, cream-white curly coat.",
          "Dog is calm in her lap with face visible; thunder sticks stay away from the dog."
        ],
        sceneRules: [
          "Excited post-hit crowd reaction in baseball stands.",
          "Generic red-and-cream baseball scarf and jersey only.",
          "Fictional Korean graphics only: top-left scoreboard, top-right 스포츠 LIVE, bottom Korean lower-third.",
          "Use fictional teams such as 서울 레드윙스 and 인천 크림스 only."
        ],
        negativePrompt: SCENE5_NEGATIVE,
        textBlacklist: ["KBO", "한화", "두산", "LG", "롯데", "삼성", "키움", "SSG", "KT", "NC", "KIA", "MBC", "SBS", "KBS", "SPOTV", "TVING", "Coupang", "Nike", "Adidas"],
        qualityGates: [
          { label: "Woman likeness", detail: "Face shape, eyes, nose, lips, hair, and glam makeup match the two woman references.", status: "required" },
          { label: "Dog likeness", detail: "Small white toy-breed dog remains calm, visible, and close to the downloaded reference.", status: "required" },
          { label: "Prop safety", detail: "Thunder sticks are not touching the dog; hands and paws are anatomically natural.", status: "required" },
          { label: "Text safety", detail: "Only fictional Korean team/broadcast text; all banned real brands and teams absent.", status: "required" },
          { label: "Broadcast crop", detail: "4:3 landscape fan-cam still, face large enough for identity review.", status: "required" }
        ],
        refinementPasses: [
          { id: "face-lock", label: "Face likeness", instruction: "Refine only the woman's face toward the two references while preserving hair, makeup, outfit, dog, and broadcast crop." },
          { id: "dog-lock", label: "Dog visibility", instruction: "Refine the dog to match the downloaded white toy-breed reference; keep face visible and calm in her lap." },
          { id: "hands-paws", label: "Hands + paws", instruction: "Repair hands, fingers, paws, and thunder-stick grip without changing identity or composition." },
          { id: "text-clean", label: "Broadcast text", instruction: "Replace any real or logo-like text with fictional Korean scoreboard/lower-third text only." }
        ],
        outputs: []
      },
      zones: {
        full_front: empty(),
        full_side:  empty(),
        full_back:  empty(),
        half_body:  empty(),
        face_front: ver(["assets/reference-dog/source.jpg"], 0),
        face_left:  empty(),
        face_right: empty(),
        outfit:     empty(),
        shoes:      empty(),
        bag:        empty(),
      },
    },
  ];

  const generatedDogSeed = {
    id: "ID-G01",
    name: "Reference Dog Multi-View",
    tagline: "Imagegen sheet split by VLM into production zones.",
    source: "assets/reference-dog/source.jpg",
    sourcePos: "center center",
    spec: {
      age: "Toy-breed puppy / young dog",
      ethnicity: "Small white toy-breed dog",
      occupation: "Reference identity",
      personality: "Calm, attentive, soft",
      hair: "Cream-white dense curly coat, puffy groomed head and ears",
      eyes: "Dark round glossy eyes",
      build: "Tiny lap-sized body, short legs, compact stance",
      expression: "Calm, direct, slightly curious",
      wardrobe: "No clothing; natural coat",
      accessories: "Blue plush toy prop from the source environment",
      style: "Photorealistic studio multi-view identity sheet",
      lighting: "Soft gray studio lighting",
      background: "Plain light gray studio background",
    },
    identityLock: true,
    prompt:
      "Use the provided dog reference as a strict identity anchor. Generate a clean photorealistic 10-panel multi-view contact sheet of the same tiny white toy-breed puppy from the reference, not a generic bichon or poodle show dog. Preserve: very small lap-sized body, oversized glossy dark round eyes set close in a round puffy baby face, tiny black button nose, short compact muzzle, cream-white silky fluffy coat with wispy flyaway hair, soft floppy ears blending into the face, slightly uneven puppy grooming, small paws, calm curious expression, red/pink harness or chest strap visible in body views, and the blue plush toy from the source as the prop detail. Plain light gray studio background. Top row: full body front standing, full body left side profile standing, full body back standing, half-body/front three-quarter sitting portrait. Middle row: face front close-up, face left profile close-up, face right profile close-up. Bottom row: coat texture close-up, front paws close-up, blue plush toy prop close-up. No text, labels, logos, or watermark. Natural anatomy and correct paws.",
    setUse: ["profile", "social", "lookbook"],
    generation: {
      useCase: "identity-preserve",
      assetType: "Photorealistic dog multi-view identity sheet",
      renderRoute: "image_gen sheet -> VLM layout inspection -> crop into zones -> populate dossier",
      sheet: "assets/generated/duoduo-sheet/sheet-02.png",
      references: [
        {
          id: "dog-source",
          label: "Dog source",
          role: "Identity anchor",
          status: "Loaded from the user-provided attachment URL",
          url: "assets/reference-dog/source.jpg",
          lock: "Small fluffy white toy-breed dog, round puffy face, dark round eyes, black nose, cream-white curly coat, tiny body"
        }
      ],
      identityContract: [
        "Preserve the same small white toy-breed dog from the provided image.",
        "Keep the round puffy face, dark eyes, black nose, cream-white curly coat, tiny body, and calm expression.",
        "Do not change the dog into another breed, a larger poodle-like dog, or a show-groomed round-head bichon."
      ],
      dogContract: [
        "All full-body and face views must read as the same dog.",
        "Paws and legs must remain natural with no extra limbs.",
        "The blue plush toy appears only in the prop/detail zone."
      ],
      sceneRules: [
        "Plain gray studio background.",
        "10-panel multi-view contact sheet generated first, then split into app zones.",
        "No in-image labels or decorative grid text."
      ],
      negativePrompt: "No text, labels, logos, watermark, extra legs, malformed paws, distorted face, different breed, different coat color, or cartoon style.",
      textBlacklist: ["logo", "watermark", "brand"],
      qualityGates: [
        { label: "Reference identity", detail: "Round puffy white toy-breed face, dark eyes, black nose, small body match the source.", status: "passed" },
        { label: "Multi-view coverage", detail: "Full front, side, back, half-body, three face angles, coat, paws, and prop zones are present.", status: "passed" },
        { label: "VLM split", detail: "The generated 10-panel sheet was visually inspected and cropped into separate zone files.", status: "passed" },
        { label: "Anatomy", detail: "No obvious extra legs or broken paws in selected crops.", status: "reviewed" }
      ],
      cropBoxes: {
        full_front: [5, 5, 378, 405],
        full_side: [385, 5, 785, 405],
        full_back: [793, 5, 1102, 405],
        half_body: [1110, 5, 1531, 405],
        face_front: [5, 412, 531, 758],
        face_left: [538, 412, 1014, 758],
        face_right: [1021, 412, 1531, 758],
        outfit: [5, 765, 531, 1018],
        shoes: [538, 765, 1014, 1018],
        bag: [1021, 765, 1531, 1018]
      },
      refinementPasses: [
        { id: "face-lock", label: "Face likeness", instruction: "Regenerate or refine the face views only, keeping the round puffy face, dark eyes, black nose, and cream-white curly coat close to the source." },
        { id: "dog-lock", label: "Body consistency", instruction: "Refine full-body views so front, side, and back read as the same tiny white toy-breed dog." },
        { id: "hands-paws", label: "Paws", instruction: "Repair paws and leg anatomy without changing the dog identity or crop composition." },
        { id: "text-clean", label: "Clean sheet", instruction: "Remove any accidental text, logo, watermark, or label from the generated sheet." }
      ],
      outputs: [
        { label: "Generated sheet", url: "assets/generated/duoduo-sheet/sheet-02.png" },
        { label: "VLM crops", url: "assets/generated/duoduo-zones/" }
      ]
    },
    zones: {
      full_front: ver(["assets/generated/duoduo-zones/full_front.png"], 0),
      full_side:  ver(["assets/generated/duoduo-zones/full_side.png"], 0),
      full_back:  ver(["assets/generated/duoduo-zones/full_back.png"], 0),
      half_body:  ver(["assets/generated/duoduo-zones/half_body.png"], 0),
      face_front: ver(["assets/generated/duoduo-zones/face_front.png"], 0),
      face_left:  ver(["assets/generated/duoduo-zones/face_left.png"], 0),
      face_right: ver(["assets/generated/duoduo-zones/face_right.png"], 0),
      outfit:     ver(["assets/generated/duoduo-zones/outfit.png"], 0),
      shoes:      ver(["assets/generated/duoduo-zones/shoes.png"], 0),
      bag:        ver(["assets/generated/duoduo-zones/bag.png"], 0),
    },
  };

  seed.splice(0, seed.length, generatedDogSeed);

  function ver(urls, selectedIndex = 0) {
    return {
      versions: urls.map((u, i) => ({
        id: "V" + String.fromCharCode(65 + i),
        url: u,
        prompt: "",
        createdAt: Date.now() - (urls.length - i) * 86400000,
        note: i === 0 ? "Initial generation" : "Variation " + String.fromCharCode(65 + i),
      })),
      selectedIndex,
      prompt: "",
      history: [],
    };
  }
  function empty() {
    return { versions: [], selectedIndex: -1, prompt: "", history: [] };
  }

  // ---- localStorage I/O
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) { console.warn("load failed", e); }
    const initial = { characters: seed.map(clone), activeId: seed[0].id };
    save(initial);
    return initial;
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function reset() {
    localStorage.removeItem(KEY);
    return load();
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function normalizeState(state) {
    if (!state || !Array.isArray(state.characters)) {
      return { characters: seed.map(clone), activeId: seed[0].id };
    }
    let changed = false;
    const byId = new Set(state.characters.map((c) => c.id));
    seed.forEach((s) => {
      if (!byId.has(s.id)) {
        state.characters.push(clone(s));
        changed = true;
      }
    });
    state.characters.forEach((c) => {
      if (!c.zones) {
        c.zones = Object.fromEntries(ZONE_DEFS.map((z) => [z.id, empty()]));
        changed = true;
      }
      ZONE_DEFS.forEach((z) => {
        if (!c.zones[z.id]) {
          c.zones[z.id] = empty();
          changed = true;
        }
      });
    });
    if (!state.activeId || !state.characters.some((c) => c.id === state.activeId)) {
      state.activeId = state.characters[0]?.id || seed[0].id;
      changed = true;
    }
    if (changed) save(state);
    return state;
  }

  // ---- helpers
  function getCharacter(state, id) {
    return state.characters.find((c) => c.id === id);
  }
  function updateCharacter(state, id, mutator) {
    const c = state.characters.find((x) => x.id === id);
    if (!c) return state;
    mutator(c);
    save(state);
    return { ...state };
  }
  function newCharacter(state) {
    const idx = state.characters.length + 1;
    const id = "ID-A" + String(idx).padStart(2, "0");
    const fresh = {
      id, name: "Unnamed Identity " + idx, tagline: "—",
      source: "",
      spec: {
        age: "—", ethnicity: "—", occupation: "—", personality: "—",
        hair: "—", eyes: "—", build: "—", expression: "—",
        wardrobe: "—", accessories: "—", style: "—",
        lighting: "—", background: "—",
      },
      identityLock: false,
      prompt: "",
      setUse: [],
      zones: Object.fromEntries(ZONE_DEFS.map((z) => [z.id, empty()])),
    };
    state.characters.push(fresh);
    state.activeId = id;
    save(state);
    return fresh;
  }

  // ---- "Agent imagine" — produces diverse prompt variations for a zone.
  // Pure deterministic mock; instant, no external call.
  const VARIANTS = {
    full_front: [
      "head-to-toe straight-on, arms relaxed at sides, gaze forward, eye-level camera",
      "head-to-toe contrapposto stance, weight on one leg, hands in pockets, three-quarter eye line",
      "head-to-toe with subtle wind movement on clothing, soft kicker light from camera right",
      "head-to-toe low angle hero shot, chin slightly up, confident posture",
    ],
    full_side:   [
      "exact profile silhouette, neutral expression, sharp horizon background",
      "profile mid-stride, natural walking pose, slight motion in fabric",
      "profile arms crossed, weight back, contemplative",
    ],
    full_back:   [
      "head-to-toe from behind, neutral stance, no head turn",
      "head-to-toe back view with slight three-quarter head turn over left shoulder",
    ],
    half_body:   [
      "waist-up portrait, hands in pockets, slight smile",
      "chest-up portrait, arms folded, direct gaze",
      "waist-up three-quarter angle, hand near jaw, considered expression",
    ],
    face_front:  [
      "frontal beauty close-up, soft butterfly light, even skin rendering",
      "tight headshot eye-level, catch-lights in both eyes, neutral mouth",
      "passport-style square portrait, hard rim light, archival feel",
    ],
    face_left:   [
      "left three-quarter face, light source camera left, gentle shadow on right cheek",
      "left profile, hard side light, cinematic chiaroscuro",
    ],
    face_right:  [
      "right three-quarter face, sunlit warm tone, soft fill",
      "right profile, north window light, editorial high-key",
    ],
    outfit:      [
      "flat-lay of full outfit on linen surface, soft top-down light, accessories arranged",
      "garment crop close-up showing fabric texture, weave, stitching",
      "outfit on mannequin, neutral backdrop, studio key + fill",
    ],
    shoes:       [
      "shoes on neutral seamless, three-quarter angle, soft long shadow",
      "shoes top-down with laces arranged, archival catalog style",
      "shoes on subject's feet mid-step, ground-level perspective",
    ],
    bag:         [
      "bag on neutral seamless, three-quarter angle, hardware in light",
      "bag worn crossbody, half-body crop showing strap and fall",
      "bag interior shot, contents arranged: card case, keys, lipstick",
    ],
  };
  function imaginePrompts(zoneId, baseSpec) {
    const variants = VARIANTS[zoneId] || ["new variation"];
    return variants.map((v, i) => ({
      id: "p" + i + "-" + Date.now() + Math.random().toString(36).slice(2,5),
      text:
        v.charAt(0).toUpperCase() + v.slice(1) +
        ". " + (baseSpec ? baseSpec + " " : "") +
        "Maintain identity lock; preserve facial features, hair, skin tone, body proportions.",
    }));
  }

  function compileGenerationPrompt(character, zoneId, localPrompt) {
    const g = character?.generation || {};
    const zone = ZONE_DEFS.find((z) => z.id === zoneId);
    const parts = [
      "Use case: " + (g.useCase || "identity-preserve"),
      "Asset type: " + (g.assetType || "photorealistic identity reference image"),
      "Target zone: " + (zone ? zone.label + " (" + zone.id + ")" : "master scene"),
      "",
      "Primary request:",
      localPrompt || character?.prompt || "",
    ];

    if (g.references?.length) {
      parts.push("", "Input references:");
      g.references.forEach((r, i) => {
        parts.push((i + 1) + ". " + r.label + " — " + r.role + ". " + r.status + ". Lock: " + r.lock + (r.url ? " Source: " + r.url : ""));
      });
    }
    if (g.identityContract?.length) parts.push("", "Identity lock:", ...g.identityContract.map((x) => "- " + x));
    if (g.dogContract?.length) parts.push("", "Dog lock:", ...g.dogContract.map((x) => "- " + x));
    if (g.sceneRules?.length) parts.push("", "Scene and graphics rules:", ...g.sceneRules.map((x) => "- " + x));
    parts.push("", "Negative prompt:", g.negativePrompt || "No distorted hands, no extra fingers, no extra limbs, no logo or watermark.");
    if (g.textBlacklist?.length) parts.push("", "Text blacklist: " + g.textBlacklist.join(", "));
    return parts.filter((p) => p !== undefined && p !== null).join("\n");
  }

  window.IG = {
    ZONE_DEFS, SET_USE_TARGETS,
    load, save, reset,
    getCharacter, updateCharacter, newCharacter,
    imaginePrompts, compileGenerationPrompt,
    U,
  };
})();
