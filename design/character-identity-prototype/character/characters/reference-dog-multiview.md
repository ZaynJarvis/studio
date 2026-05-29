# Reference Dog Multi-View

## Source

- Input mode: Generated from user-provided reference image, then split by VLM inspection
- Reference file(s): `assets/reference-dog/source.jpg`
- Generated sheet: `assets/generated/duoduo-sheet/sheet-02.png`
- VLM crop output directory: `assets/generated/duoduo-zones/`

## Design Intent

Create a reusable identity dossier for the same small fluffy white toy-breed dog in the source image. The workflow is image generation first, visual layout inspection second, then deterministic crops into the app's required zones.

## Identity & Casting

- Apparent age: Toy-breed puppy / young dog
- Role: Reference dog identity
- Build and height impression: Tiny lap-sized body, short legs, compact stance
- Posture and movement quality: Calm, attentive, studio-safe standing/sitting poses

## Face & Coat

- Face shape: Round puffy face
- Coat: Cream-white dense curly coat, puffy groomed head and ears
- Eyes: Dark round glossy eyes
- Nose: Small black nose
- Expression: Calm, direct, slightly curious
- Distinguishing details: Toy-breed proportions, soft ears, compact body

## Multi-View Sheet Prompt

Use the visible source dog photo as the strict identity reference. Generate a photorealistic multi-view contact sheet of the SAME tiny white toy-breed puppy from the reference, not a generic bichon or poodle show dog. Preserve these exact identity cues: very small lap-sized body, oversized glossy dark round eyes set close in a round puffy baby face, tiny black button nose, short compact muzzle, cream-white silky fluffy coat with wispy flyaway hair, soft floppy ears blending into the face, slightly uneven puppy grooming, small paws, calm curious expression, red/pink harness or chest strap visible in body views, and the blue plush toy from the reference in the prop detail panel. Keep the dog looking like the home-photo reference, only cleaned up with studio lighting.

Create a clean 10-panel sheet with no text and no labels, separated by plain white gutters: top row four panels: full body front standing, full body left side profile standing, full body back view standing, half-body/front three-quarter portrait sitting; middle row three panels: face front close-up, face left profile close-up, face right profile close-up; bottom row three panels: coat texture close-up, front paws close-up, blue plush toy prop close-up. Plain light gray studio background, realistic soft light, consistent dog identity in every panel.

Negative constraints: do not make a round show-groomed bichon head, do not make a tall poodle, do not change to another breed, no snowball-perfect haircut, no long snout, no large black eyes spaced too far apart, no text, no logos, no watermarks, no extra legs, no malformed paws, no cartoon style.

## VLM Crop Map

- `full_front`: `[5, 5, 378, 405]`
- `full_side`: `[385, 5, 785, 405]`
- `full_back`: `[793, 5, 1102, 405]`
- `half_body`: `[1110, 5, 1531, 405]`
- `face_front`: `[5, 412, 531, 758]`
- `face_left`: `[538, 412, 1014, 758]`
- `face_right`: `[1021, 412, 1531, 758]`
- `outfit`: `[5, 765, 531, 1018]` as coat texture detail
- `shoes`: `[538, 765, 1014, 1018]` as paws detail
- `bag`: `[1021, 765, 1531, 1018]` as toy/prop detail

## Negative Prompt

- No text
- No labels
- No logos
- No watermark
- No extra legs
- No malformed paws
- No distorted face
- No different breed
- No different coat color
- No cartoon style

## Continuity Rules

- All zones must read as the same dog identity.
- Front, side, back, and face crops must preserve the round puffy face, dark eyes, black nose, cream-white curly coat, and tiny body.
- Detail zones are allowed to represent coat texture, paws, and the source-like blue plush toy rather than human outfit/shoes/bag semantics.
