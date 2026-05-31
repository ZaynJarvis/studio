export const GENERIC_ZONE_DEFS = [
  { id: "full_front", group: "body", label: "Full Front", role: "front full-body view", aspect: "1 / 1", prompt: "Full-body front view, standing upright, facing the camera directly, entire figure head-to-toe centered in frame." },
  { id: "full_side", group: "body", label: "Full Side", role: "left side full-body view", aspect: "1 / 1", prompt: "Full-body left-side profile view, standing upright, entire figure head-to-toe centered in frame." },
  { id: "full_back", group: "body", label: "Full Back", role: "back full-body view", aspect: "1 / 1", prompt: "Full-body back view, standing upright, entire figure head-to-toe centered in frame." },
  { id: "face_front", group: "face", label: "Face Front", role: "front face close-up", aspect: "1 / 1", prompt: "Head-and-shoulders face close-up, front view, neutral calm expression, sharp facial detail, identity locked." },
  { id: "face_left", group: "face", label: "Face 3/4 L", role: "left three-quarter face close-up", aspect: "1 / 1", prompt: "Head-and-shoulders face close-up, three-quarter left view, same neutral expression and identity as the front face." },
  { id: "face_right", group: "face", label: "Face 3/4 R", role: "right three-quarter face close-up", aspect: "1 / 1", prompt: "Head-and-shoulders face close-up, three-quarter right view, same neutral expression and identity as the front face." },
  { id: "expression", group: "face", label: "Expression", role: "smiling expression close-up", aspect: "1 / 1", prompt: "Head-and-shoulders face close-up, front view, warm happy smiling expression, same identity preserved." },
  { id: "half_body", group: "body", label: "Half Body", role: "waist-up portrait", aspect: "1 / 1", prompt: "Waist-up three-quarter portrait, relaxed neutral pose, clear face and upper-body detail." },
  { id: "outfit", group: "detail", label: "Outfit", role: "outfit & accessories detail", aspect: "1 / 1", prompt: "Three-quarter body view emphasizing the full outfit, clothing, and accessories on the same character." },
];

export const DEFAULT_CHARACTER_TEMPLATE = {
  id: "custom",
  code: "ID-CUSTOM",
  name: "Character",
  shortName: "Character",
  spec: [
    ["Identity", "Uploaded reference character"],
    ["Build", "Preserve source body scale and proportions"],
    ["Face", "Preserve source facial identity"],
    ["Wardrobe", "Preserve source wardrobe and props"],
    ["Lighting", "Use source image as identity anchor"],
    ["Background", "Plain soft light-gray studio background"],
  ],
  identityContract: [
    "Preserve the same character from the source image across every generated view.",
    "Keep face, body scale, outfit, color palette, and recognizable props consistent with the reference.",
    "Do not merge this character with other characters or drift into a different identity.",
  ],
  negativePrompt: "No text, labels, logos, watermark, merged identity, different character, distorted face, malformed hands, extra limbs, or cartoon style unless requested.",
  zones: GENERIC_ZONE_DEFS,
  custom: true,
};

export const CHARACTER_DESIGNS = [];
export const DEFAULT_CHARACTER_DESIGN = DEFAULT_CHARACTER_TEMPLATE;
