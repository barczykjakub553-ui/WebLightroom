/* WebLightroom — extended built-in preset library.
 * Creative looks are defined once and generated in three strengths (Light / normal / Strong).
 * Looks set the whole "look" (tone, presence, curve, color, grading, effects) so they don't stack
 * unpredictably; utility presets in the "Basic" groups only touch the settings they name.
 */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const S = LR.Settings;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const Z = () => [0, 0, 0, 0, 0, 0, 0, 0];
  const m = (...objs) => objs.reduce((acc, o) => S.deepMerge(acc, o || {}), {});
  // HSL arrays in order: Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta
  const H = (hue, sat, lum) => ({ hsl: { hue: hue || Z(), sat: sat || Z(), lum: lum || Z() } });
  const tone = (a) => (a ? { h: a[0], s: a[1], l: a[2] || 0 } : { h: 0, s: 0, l: 0 });
  const CG = (sh, mid, hi, gl, blending, balance) => ({
    grading: { shadows: tone(sh), midtones: tone(mid), highlights: tone(hi), global: tone(gl), blending: blending == null ? 50 : blending, balance: balance || 0 },
  });
  const FADE = (lift, roll) => ({ curve: { master: [[0, lift], [0.5, 0.5 + lift * 0.25 - roll * 0.25], [1, 1 - roll]] } });
  const SC = (k) => ({ curve: { master: [[0, 0], [0.25, 0.25 - k], [0.75, 0.75 + k], [1, 1]] } });
  const MATTE = (lift, k) => ({ curve: { master: [[0, lift], [0.25, 0.25 - k * 0.5 + lift * 0.4], [0.75, 0.75 + k], [1, 0.97]] } });
  const GR = (amount, size, rough) => ({ grain: { amount, size: size == null ? 25 : size, roughness: rough == null ? 50 : rough } });
  const VG = (amount, mid, feather) => ({ vignette: { amount, midpoint: mid == null ? 50 : mid, feather: feather == null ? 60 : feather, roundness: 0, highlights: 0 } });
  const BW = (mix, rest) => m({ treatment: 'bw', bw: mix || Z() }, rest);

  /* ---------- creative looks ---------- */
  const LOOKS = {
    'Film': [
      ['Warm Portrait Film', m({ temp: 6, contrast: -10, highlights: -25, shadows: 15, saturation: -8, vibrance: 10 }, MATTE(0.04, 0.03), H([3, -5, -8, 15, 0, -8, 0, 0], [-5, -10, -15, -20, 0, -10, 0, 0], [0, 8, 5, 0, 0, 0, 0, 0]), CG([200, 8], [40, 6], [45, 12]), GR(15, 20, 40))],
      ['Fine Grain Pastel', m({ contrast: -20, highlights: -30, shadows: 25, saturation: -15, vibrance: 5 }, FADE(0.06, 0.04), H(null, [-10, -15, -20, -25, -10, -15, -10, -10]), CG([210, 10], null, [50, 10]), GR(10, 15, 30))],
      ['Vivid Slide', m({ contrast: 30, highlights: -20, blacks: -15, vibrance: 25, saturation: 15 }, SC(0.06), H([0, 0, 0, 10, 0, -5, 0, 0], [15, 5, 10, 15, 20, 25, 10, 10], [-5, 0, 0, -10, 0, -15, 0, 0]), CG([230, 10]))],
      ['Saturated Landscape Slide', m({ contrast: 25, saturation: 25, vibrance: 15, dehaze: 8, clarity: 10 }, SC(0.05), H(null, [10, 5, 15, 25, 25, 30, 0, 0], [0, 0, 0, -10, -5, -20, 0, 0]), VG(-10))],
      ['Tungsten Night Film', m({ temp: -25, tint: 5, contrast: 10, highlights: -30, shadows: 10 }, H([10, -10, 0, 30, 0, 0, 0, 0], [10, -10, -20, -30, 15, 15, 0, 0]), CG([190, 25], [200, 8], [20, 15]), GR(25, 30, 55))],
      ['Consumer Color 400', m({ temp: 5, contrast: 10, saturation: 5, vibrance: 10 }, MATTE(0.05, 0.03), H([0, 0, -10, 25, 0, 0, 0, 0], [5, 5, 0, -15, 0, 0, 0, 0]), CG([160, 10], [45, 6], [50, 8]), GR(30, 35, 60))],
      ['Expired Film', m({ temp: 15, tint: 12, contrast: -10, saturation: -20 }, FADE(0.1, 0.06), CG([300, 15], [30, 10], [60, 20]), GR(35, 35, 70), VG(-15))],
      ['Cross Process', m({ contrast: 25, saturation: 15, curve: { master: [[0, 0], [1, 1]], r: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]], g: [[0, 0.05], [0.5, 0.55], [1, 1]], b: [[0, 0.15], [1, 0.85]] } }, CG(null, null, [60, 20]))],
      ['Bleach Bypass', m({ contrast: 40, saturation: -45, clarity: 20, highlights: -20, blacks: -10 }, CG([210, 8]), GR(15))],
      ['Instant Film', m({ temp: 8, tint: 6, contrast: -15, highlights: -30, saturation: -10 }, FADE(0.08, 0.07), CG([180, 12], [40, 8], [55, 15]), VG(-20, 40, 70))],
      ['Faded Instant', m({ temp: 5, contrast: -20, saturation: -30 }, FADE(0.14, 0.08), CG([200, 15], null, [50, 18]), VG(-15))],
      ['Super 8', m({ temp: 18, contrast: 15, saturation: -10 }, FADE(0.06, 0.05), CG([20, 15], [35, 10], [50, 20]), GR(45, 50, 70), VG(-35, 35, 60))],
      ['Classic Chrome Style', m({ contrast: 20, highlights: -20, shadows: -5, saturation: -25, vibrance: 5 }, SC(0.04), H([0, 0, -10, 0, 0, -5, 0, 0], [0, -10, -20, -30, -10, -15, -20, -20]), CG([200, 8], null, [45, 6]))],
      ['Pro Negative', m({ contrast: 20, vibrance: 10 }, SC(0.05), H(null, [5, 0, -5, -5, 0, 5, 0, 0]), CG(null, [40, 5]))],
    ],
    'Cinematic': [
      ['Blockbuster', m({ contrast: 25, highlights: -30, shadows: 15, vibrance: 10 }, H([0, -5, -15, 40, 0, -10, 0, 0], [0, 15, -30, -50, 15, 15, -30, -30]), CG([185, 40, -5], [30, 8], [35, 35], null, 40))],
      ['Neo Noir', m({ exposure: -0.3, contrast: 35, highlights: -40, blacks: -20, saturation: -40, clarity: 15 }, CG([210, 25], [200, 5], [40, 10]), VG(-35, 40, 50))],
      ['Desert Heat', m({ temp: 25, tint: 5, contrast: 15, highlights: -20, vibrance: -5, dehaze: 5 }, H(null, [0, 15, 10, -40, -30, -30, 0, 0]), CG([25, 15], [35, 20], [45, 25]))],
      ['Arctic Blue', m({ temp: -30, contrast: 10, saturation: -20, highlights: -15, shadows: 10 }, FADE(0.04, 0.02), CG([215, 30], [205, 15], [195, 10]))],
      ['Neon Nights', m({ temp: -10, tint: 15, contrast: 20, vibrance: 30, saturation: 10, highlights: -25, clarity: 10 }, H([0, 0, 0, 0, 0, 10, 15, 10], [20, 0, -20, -30, 25, 25, 30, 30]), CG([250, 30], [290, 10], [320, 15]))],
      ['Golden Hour Epic', m({ temp: 20, contrast: 20, highlights: -35, shadows: 20, vibrance: 15, dehaze: 5 }, CG([210, 20], [35, 15], [40, 30]), VG(-20))],
      ['Muted Drama', m({ contrast: 25, highlights: -40, shadows: -5, saturation: -35, clarity: 20 }, MATTE(0.04, 0.05), CG([200, 15], null, [40, 10]))],
      ['Emerald Forest', m({ temp: -5, contrast: 15 }, H([0, 0, 15, 25, 20, 0, 0, 0], [-10, 0, -10, 10, 15, -10, 0, 0], [0, 0, 0, -20, -10, 0, 0, 0]), CG([150, 30], [160, 8], [50, 12]))],
      ['Vintage Hollywood', m({ temp: 10, contrast: 15, saturation: -20 }, FADE(0.06, 0.06), CG([30, 10], [40, 12], [50, 20]), GR(20), VG(-25))],
      ['Sci-Fi Cyan', m({ temp: -20, tint: -10, contrast: 25, saturation: -10, clarity: 10 }, H(null, [-30, -20, -20, 0, 30, 10, -20, -20]), CG([185, 35], [180, 15], [175, 15]))],
      ['Thriller Green', m({ tint: -20, contrast: 20, saturation: -25, highlights: -20 }, CG([140, 25], [90, 15], [60, 10]), VG(-25))],
      ['Romance Pink', m({ tint: 15, temp: 5, contrast: -10, highlights: -20, shadows: 15, texture: -10 }, FADE(0.05, 0.03), CG([320, 15], [340, 10], [20, 15]))],
    ],
    'Portrait': [
      ['Clean Skin', m({ texture: -25, clarity: -5, highlights: -15, shadows: 10, vibrance: 5 }, H(null, [0, -10, 0, 0, 0, 0, 0, 0], [0, 15, 5, 0, 0, 0, 0, 0]))],
      ['Soft Glow', m({ exposure: 0.15, texture: -30, clarity: -25, contrast: -15, highlights: -10, dehaze: -10 }, CG(null, null, [40, 10]))],
      ['Warm Skin', m({ temp: 10, vibrance: 10 }, H([0, -5, 0, 0, 0, 0, 0, 0], [0, 5, 0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0, 0, 0]), CG([30, 8], [30, 8], [40, 10]))],
      ['Matte Portrait', m({ contrast: -10, highlights: -20, shadows: 15, saturation: -10 }, MATTE(0.08, 0.03), CG([210, 10], null, [40, 8]))],
      ['High Key Portrait', m({ exposure: 0.6, contrast: -20, highlights: -40, shadows: 40, whites: 20, blacks: 20, saturation: -10, texture: -15 })],
      ['Low Key Portrait', m({ exposure: -0.5, contrast: 30, highlights: -30, shadows: -30, blacks: -20, clarity: 10 }, VG(-40, 35, 50))],
      ['Editorial', m({ contrast: 20, highlights: -25, shadows: 10, saturation: -15, clarity: 10, texture: 10 }, SC(0.04), CG([220, 10], null, [40, 5]))],
      ['Bronze', m({ temp: 15, contrast: 15, saturation: -10, clarity: 10 }, H(null, [10, 15, -10, -30, -20, -30, 0, 0]), CG([30, 20], [35, 15], [45, 20]))],
      ['Peach Tone', m({ temp: 8, tint: 8, highlights: -15, shadows: 10 }, FADE(0.04, 0.02), H([5, -8, 0, 0, 0, 0, 0, 0], null, [5, 12, 0, 0, 0, 0, 0, 0]), CG([10, 10], [20, 8], [30, 12]))],
      ['Natural Light', m({ highlights: -20, shadows: 15, whites: 5, blacks: -5, vibrance: 15, texture: -5 })],
    ],
    'Landscape': [
      ['Golden Hour', m({ temp: 18, highlights: -30, shadows: 20, vibrance: 20, dehaze: 5 }, CG([220, 10], [35, 10], [40, 25]))],
      ['Blue Hour', m({ temp: -20, tint: 5, highlights: -20, shadows: 15, vibrance: 20, clarity: 10 }, CG([230, 25], [220, 10], [200, 5]))],
      ['Lush Greens', m({ vibrance: 20, clarity: 10, contrast: 10 }, H([0, 0, 10, 15, 0, 0, 0, 0], [0, 0, 10, 25, 15, 0, 0, 0], [0, 0, 5, -5, 0, 0, 0, 0]))],
      ['Autumn Colors', m({ temp: 10, vibrance: 25, contrast: 15 }, H([0, -5, -15, -35, 0, 0, 0, 0], [20, 30, 25, -10, 0, 0, 0, 0], [0, 5, 0, -10, 0, 0, 0, 0]))],
      ['Dramatic Sky', m({ highlights: -70, whites: -10, dehaze: 25, clarity: 20, contrast: 20 }, H(null, [0, 0, 0, 0, 10, 25, 0, 0], [0, 0, 0, 0, -10, -30, 0, 0]), VG(-15))],
      ['Misty Morning', m({ dehaze: -25, contrast: -20, highlights: -10, shadows: 20, saturation: -15, temp: -8 }, FADE(0.06, 0.03), CG([210, 10], null, [40, 8]))],
      ['Desert Dunes', m({ temp: 20, contrast: 20, clarity: 15, texture: 15 }, H(null, [0, 20, 15, 0, 0, 15, 0, 0], [0, -10, 0, 0, 0, -10, 0, 0]), CG(null, [30, 15]))],
      ['Alpine Clear', m({ temp: -5, contrast: 15, dehaze: 20, clarity: 15, vibrance: 20, whites: 10, blacks: -10 }, H(null, [0, 0, 0, 10, 15, 20, 0, 0], [0, 0, 0, 0, 0, -15, 0, 0]))],
      ['Seascape', m({ temp: -10, vibrance: 25, clarity: 10 }, H([0, 0, 0, 0, 10, -5, 0, 0], [0, 0, 0, 0, 30, 20, 0, 0], [0, 0, 0, 0, 5, -10, 0, 0]), CG([200, 15], null, [50, 8]))],
      ['Sunset Boost', m({ temp: 15, tint: 8, vibrance: 35, highlights: -40, dehaze: 10 }, H(null, [20, 25, 20, 0, 0, 0, 15, 20]), VG(-15))],
    ],
    'Urban & Street': [
      ['Gritty Street', m({ contrast: 35, clarity: 40, texture: 20, saturation: -40, highlights: -30, shadows: 10 }, GR(20, 20, 70), VG(-20))],
      ['Urban Matte', m({ contrast: -5, saturation: -25, clarity: 10 }, MATTE(0.08, 0.04), CG([200, 15], null, [35, 10]))],
      ['Concrete Cool', m({ temp: -15, saturation: -30, contrast: 15, clarity: 15 }, CG([210, 15], [210, 5], [200, 5]))],
      ['Cyberpunk', m({ tint: 20, temp: -15, contrast: 25, vibrance: 30 }, H([0, 0, 0, 0, 0, 15, 15, 0], [25, -20, -40, -60, 30, 30, 40, 40]), CG([260, 35], [280, 10], [320, 25]))],
      ['Rainy Day', m({ temp: -12, saturation: -20, contrast: -5, highlights: -20, dehaze: -10 }, FADE(0.04, 0.03), CG([210, 15]))],
      ['Faded Street', m({ saturation: -20, contrast: -10 }, FADE(0.12, 0.05), CG([190, 10], [40, 5], [45, 10]), GR(15))],
      ['Documentary', m({ contrast: 15, saturation: -30, clarity: 15, highlights: -20, shadows: 10, texture: 10 })],
      ['High Contrast Urban', m({ contrast: 50, blacks: -20, whites: 15, clarity: 25, saturation: -15, dehaze: 10 })],
    ],
    'Travel & Lifestyle': [
      ['Sunny Travel', m({ temp: 8, vibrance: 25, highlights: -20, shadows: 15 }, H(null, [0, 10, 10, 10, 20, 20, 0, 0]), CG(null, [40, 5], [45, 10]))],
      ['Tropical', m({ vibrance: 35, saturation: 10, temp: 5, clarity: 5 }, H([0, 0, 0, 15, -10, -10, 0, 0], [10, 10, 15, 20, 30, 25, 0, 0]))],
      ['Mediterranean', m({ temp: 10, contrast: 15, vibrance: 20 }, H(null, [0, 15, 10, -10, 20, 25, 0, 0], [0, 5, 0, 0, 0, -10, 0, 0]), CG(null, null, [45, 15]))],
      ['Nordic', m({ temp: -10, saturation: -20, contrast: 10, highlights: -20, shadows: 10 }, FADE(0.04, 0.03), CG([210, 12], [200, 5], [50, 5]))],
      ['Cafe Warm', m({ temp: 15, contrast: 10, saturation: -10, highlights: -20 }, FADE(0.04, 0.02), CG([30, 10], [35, 10], [40, 15]), VG(-20))],
      ['Clean Bright', m({ exposure: 0.3, highlights: -30, shadows: 25, whites: 10, blacks: 5, vibrance: 10, contrast: -5 })],
      ['Airy Pastel', m({ exposure: 0.35, contrast: -25, highlights: -35, shadows: 30, saturation: -20 }, FADE(0.08, 0.02), CG([200, 8], null, [40, 6]))],
      ['Moody Interior', m({ exposure: -0.3, contrast: 15, highlights: -30, shadows: -10, saturation: -15, temp: 8 }, CG([210, 12], [30, 8]), VG(-30))],
    ],
    'Vintage': [
      ['70s Warm', m({ temp: 20, tint: 5, contrast: -5, saturation: -10 }, FADE(0.08, 0.05), CG([30, 20], [40, 15], [50, 20]), GR(25, 35, 60))],
      ['80s Pop', m({ contrast: 20, vibrance: 30, saturation: 15, tint: 8 }, CG([250, 15], [300, 8], [40, 10]), GR(15))],
      ['90s Disposable', m({ contrast: 15, temp: 5, saturation: 5, highlights: 10, whites: 15 }, CG([170, 15], [50, 10], [60, 10]), GR(35, 40, 65), VG(-25, 40, 50))],
      ['Sepia Tint Color', m({ saturation: -60, temp: 15 }, FADE(0.05, 0.04), CG([35, 30], [40, 20], [45, 20]))],
      ['Faded Memory', m({ saturation: -35, contrast: -15 }, FADE(0.15, 0.08), CG([30, 8], null, [50, 12]), GR(20))],
      ['Polaroid Warm', m({ temp: 12, tint: 8, contrast: -10 }, FADE(0.1, 0.06), CG([180, 15], [40, 10], [50, 20]), VG(-20, 40, 70))],
      ['Old Postcard', m({ saturation: -25, temp: 10, contrast: 10 }, FADE(0.06, 0.06), H([0, 0, 0, 0, -20, -20, 0, 0]), CG([190, 20], [45, 15], [50, 25]), GR(15))],
      ['Retro Teal', m({ saturation: -10, contrast: 10 }, FADE(0.05, 0.04), H([0, 0, 0, 30, -10, -20, 0, 0]), CG([180, 30], [170, 10], [40, 15]))],
    ],
    'Seasons': [
      ['Spring Fresh', m({ exposure: 0.15, vibrance: 20, temp: 3, tint: -3, contrast: -5 }, H([0, 0, 10, 10, 0, 0, 0, 10], [10, 0, 10, 20, 0, 0, 10, 20]))],
      ['Summer Bright', m({ exposure: 0.2, vibrance: 30, temp: 8, highlights: -25, shadows: 20 }, H(null, [0, 10, 15, 10, 20, 20, 0, 0]))],
      ['Autumn Warm', m({ temp: 18, vibrance: 20 }, H([0, -8, -20, -40, 0, 0, 0, 0], [15, 25, 20, -20, 0, -10, 0, 0]), CG([25, 12], null, [40, 15]))],
      ['Winter Cold', m({ temp: -25, saturation: -15, contrast: 10, whites: 10 }, CG([210, 25], [210, 10], [200, 10]))],
      ['Winter Wonderland', m({ temp: -12, exposure: 0.3, highlights: -30, whites: 15, shadows: 15, vibrance: 10 }, CG([220, 15], null, [200, 5]))],
      ['Harvest Gold', m({ temp: 15, contrast: 10 }, H([0, -5, -10, -30, 0, 0, 0, 0], [10, 20, 25, -10, 0, -20, 0, 0], [0, 5, 10, 0, 0, 0, 0, 0]), CG(null, [45, 15], [50, 15]))],
    ],
    'Food & Product': [
      ['Fresh Food', m({ vibrance: 20, clarity: 10, texture: 15, highlights: -15, shadows: 15, temp: 3 }, H(null, [10, 10, 10, 15, 0, 0, 0, 0]))],
      ['Warm Food', m({ temp: 15, vibrance: 15, texture: 10, contrast: 10 }, CG(null, [35, 10], [40, 10]))],
      ['Dark Food', m({ exposure: -0.4, contrast: 25, highlights: -30, shadows: -15, saturation: -10, texture: 15 }, VG(-40, 35, 50))],
      ['Product Clean', m({ exposure: 0.25, contrast: 10, highlights: -20, whites: 15, blacks: -5, clarity: 10, texture: 15, saturation: -5 })],
      ['Crisp Detail', m({ texture: 30, clarity: 20, contrast: 10, dehaze: 5 })],
    ],
    'Wedding': [
      ['Bright & Airy', m({ exposure: 0.4, contrast: -15, highlights: -40, shadows: 30, saturation: -10, vibrance: 5, temp: 3, texture: -10 }, FADE(0.04, 0.01))],
      ['Romantic Warm', m({ temp: 12, tint: 5, contrast: -5, highlights: -20, texture: -10 }, CG([20, 10], [30, 8], [40, 15]))],
      ['Fine Art', m({ saturation: -20, contrast: -10, highlights: -25, shadows: 20 }, MATTE(0.06, 0.03), H(null, null, [0, 10, 0, 0, 0, 0, 0, 0]), CG([200, 8], [40, 5], [45, 8]))],
      ['Moody Wedding', m({ exposure: -0.2, contrast: 15, highlights: -35, saturation: -25 }, MATTE(0.05, 0.04), CG([210, 15], [30, 8], [40, 10]), VG(-25))],
      ['Classic Wedding', m({ contrast: 10, highlights: -20, shadows: 10, vibrance: 10, texture: -5 })],
    ],
    'Creative': [
      ['Duotone Blue Orange', m({ saturation: -100 }, CG([215, 60, -5], null, [35, 55, 5], null, 40))],
      ['Pink Dream', m({ tint: 20, temp: 5, contrast: -15, saturation: -10 }, FADE(0.08, 0.04), CG([320, 25], [340, 15], [350, 15]))],
      ['Purple Haze', m({ tint: 15, temp: -10, dehaze: -15 }, FADE(0.06, 0.03), CG([270, 30], [280, 15], [300, 10]))],
      ['Faux Infrared', m({ contrast: 20, temp: 10 }, H([0, 0, -30, -30, 0, 0, 0, 0], [0, 0, -20, -40, 0, 0, 0, 0], [0, 0, 30, 60, 0, -40, 0, 0]), CG(null, null, [340, 12]))],
      ['Monochrome Blue', m({ saturation: -100 }, CG([220, 40], [215, 30], [210, 20]))],
      ['Lomo Vignette', m({ contrast: 35, saturation: 20, vibrance: 10, dehaze: 10 }, CG([200, 20], null, [55, 20]), VG(-60, 25, 40))],
      ['Dreamy Haze', m({ dehaze: -25, clarity: -20, contrast: -15, highlights: -10, shadows: 15 }, FADE(0.06, 0.02), CG(null, null, [40, 15]))],
      ['Split Tone Classic', m({ saturation: -20 }, CG([220, 25], null, [40, 25]))],
    ],
    'Black & White': [
      ['B&W Neutral', BW(null, {})],
      ['B&W High Contrast Punch', BW([-10, -10, 0, -20, -20, -30, -10, -10], m({ contrast: 50, whites: 20, blacks: -30, clarity: 20 }))],
      ['B&W Low Contrast', BW(null, m({ contrast: -30, highlights: -20, shadows: 30 }))],
      ['B&W Soft Matte', BW(null, m({ contrast: -10, highlights: -15, shadows: 15 }, MATTE(0.1, 0.03)))],
      ['B&W Dramatic', BW([20, 10, 0, -30, -40, -60, -20, 0], m({ contrast: 40, highlights: -50, shadows: -10, clarity: 35, dehaze: 15 }, VG(-30)))],
      ['B&W Classic Grain', BW(null, m({ contrast: 20, clarity: 10 }, GR(40, 30, 60)))],
      ['B&W Red Filter', BW([40, 30, 10, -30, -40, -60, -20, 20], m({ contrast: 20 }))],
      ['B&W Orange Filter', BW([30, 35, 15, -20, -30, -40, -15, 10], m({ contrast: 15 }))],
      ['B&W Yellow Filter', BW([10, 20, 30, 0, -10, -25, -10, 0], m({ contrast: 10 }))],
      ['B&W Green Filter', BW([-20, -10, 10, 40, 10, -10, 0, -20], m({ contrast: 10 }))],
      ['B&W Blue Filter', BW([-40, -30, -20, 0, 20, 40, 20, 0], m({ contrast: 10 }))],
      ['B&W Infrared', BW([0, 10, 40, 80, 20, -60, 0, 0], m({ contrast: 30, whites: 15, clarity: -10 }, GR(25, 35, 50)))],
      ['B&W Selenium', BW(null, m({ contrast: 25 }, CG([260, 15], [270, 5])))],
      ['B&W Sepia Tone', BW(null, m({ contrast: 10 }, FADE(0.04, 0.03), CG([35, 30], [40, 25], [45, 20])))],
      ['B&W Cyanotype', BW(null, m({ contrast: 15 }, CG([205, 45], [205, 30], [200, 15])))],
      ['B&W Platinum', BW(null, m({ contrast: -15, highlights: -20, shadows: 15 }, FADE(0.05, 0.04), CG([30, 8], [40, 10], [45, 12])))],
      ['B&W Noir', BW([0, 0, 0, -20, -20, -30, 0, 0], m({ exposure: -0.3, contrast: 55, blacks: -25, highlights: -20 }, VG(-45, 35, 50)))],
      ['B&W Street', BW(null, m({ contrast: 30, clarity: 30, texture: 15 }, GR(30, 25, 70), VG(-15)))],
    ],
  };

  const LOOK_KEYS = ['treatment', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation', 'curve', 'curveParam', 'hsl', 'bw', 'grading', 'vignette', 'grain'];
  function full(partial) {
    const d = S.defaults();
    const o = {};
    LOOK_KEYS.forEach((k) => (o[k] = S.clone(d[k])));
    return S.deepMerge(o, S.clone(partial));
  }

  const NOSCALE = new Set(['h', 'blending', 'balance', 'size', 'roughness', 'midpoint', 'feather', 'roundness', 'radius', 's1', 's2', 's3', 'treatment']);
  function scale(o, k, key) {
    if (Array.isArray(o)) {
      if (Array.isArray(o[0])) return o.map(([x, y]) => [x, clamp(x + (y - x) * k, 0, 1)]);
      return o.map((v) => Math.round(clamp(v * k, -100, 100)));
    }
    if (o && typeof o === 'object') {
      const r = {};
      for (const kk in o) r[kk] = NOSCALE.has(kk) ? o[kk] : scale(o[kk], k, kk);
      return r;
    }
    if (typeof o === 'number') return key === 'exposure' ? Math.round(clamp(o * k, -5, 5) * 100) / 100 : Math.round(clamp(o * k, -100, 100));
    return o;
  }

  const slug = (s) => s.toLowerCase().replace(/\+/g, 'plus').replace(/(^|\s)-(?=\d)/g, '$1minus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out = [];
  const add = (group, name, settings) => out.push({ id: 'builtin-' + slug(group + '-' + name), name, group, builtin: true, settings });

  const STRENGTHS = [['Light', 0.5], [null, 1], ['Strong', 1.6]];
  Object.entries(LOOKS).forEach(([group, looks]) => {
    looks.forEach(([name, partial]) => {
      const base = full(partial);
      STRENGTHS.forEach(([suffix, k]) => add(group, suffix ? name + ' · ' + suffix : name, k === 1 ? base : scale(base, k)));
    });
  });

  /* ---------- utility presets (partial: only the named settings) ---------- */
  const U = (group, name, s) => add(group, name, s);
  const T = 'Basic · Tone', C = 'Basic · Color', D = 'Basic · Detail', E = 'Basic · Effects', K = 'Basic · Curve';
  [-1, -0.67, -0.33, 0.33, 0.67, 1].forEach((v) => U(T, 'Exposure ' + (v > 0 ? '+' : '') + v.toFixed(2), { exposure: v }));
  U(T, 'Contrast Low', { contrast: -25 });
  U(T, 'Contrast Medium', { contrast: 20 });
  U(T, 'Contrast High', { contrast: 45 });
  U(T, 'Recover Highlights', { highlights: -50 });
  U(T, 'Recover Highlights Max', { highlights: -100, whites: -15 });
  U(T, 'Lift Shadows', { shadows: 40 });
  U(T, 'Lift Shadows Max', { shadows: 80, blacks: 10 });
  U(T, 'Flatten (HDR-ish)', { highlights: -80, shadows: 70, contrast: -10, clarity: 20 });
  U(T, 'Clarity Soften', { clarity: -30 });
  U(T, 'Clarity +25', { clarity: 25 });
  U(T, 'Clarity +50', { clarity: 50 });
  U(T, 'Texture Smooth', { texture: -30 });
  U(T, 'Texture Enhance', { texture: 30 });
  U(T, 'Dehaze Light', { dehaze: 20 });
  U(T, 'Dehaze Strong', { dehaze: 50 });
  U(T, 'Add Haze', { dehaze: -20 });
  U(C, 'Vibrance +25', { vibrance: 25 });
  U(C, 'Vibrance +50', { vibrance: 50 });
  U(C, 'Saturation +20', { saturation: 20 });
  U(C, 'Saturation -30', { saturation: -30 });
  U(C, 'Desaturate', { saturation: -100 });
  [10, 20, 35].forEach((v) => U(C, 'Warm +' + v, { temp: v, wbMode: 'Custom' }));
  [10, 20, 35].forEach((v) => U(C, 'Cool -' + v, { temp: -v, wbMode: 'Custom' }));
  U(C, 'Tint Magenta', { tint: 10, wbMode: 'Custom' });
  U(C, 'Tint Green', { tint: -10, wbMode: 'Custom' });
  U(C, 'White Balance As Shot', { temp: 0, tint: 0, wbMode: 'As Shot' });
  U(C, 'Reset HSL', { hsl: { hue: Z(), sat: Z(), lum: Z() } });
  U(C, 'Reset Color Grading', CG(null, null, null, null, 50, 0));
  U(D, 'Sharpen Low', { sharpen: { amount: 30, radius: 1, detail: 25, masking: 0 } });
  U(D, 'Sharpen Medium', { sharpen: { amount: 60, radius: 1, detail: 25, masking: 20 } });
  U(D, 'Sharpen High', { sharpen: { amount: 100, radius: 1.2, detail: 35, masking: 30 } });
  U(D, 'Sharpen Landscapes', { sharpen: { amount: 70, radius: 0.8, detail: 50, masking: 10 } });
  U(D, 'Sharpen Faces', { sharpen: { amount: 40, radius: 1.4, detail: 15, masking: 60 } });
  U(D, 'Noise Reduction Low', { nr: { luminance: 15, color: 25 } });
  U(D, 'Noise Reduction Medium', { nr: { luminance: 35, color: 35 } });
  U(D, 'Noise Reduction High', { nr: { luminance: 60, color: 50 } });
  U(E, 'Vignette Light', VG(-15, 50, 70));
  U(E, 'Vignette Medium', VG(-30, 45, 60));
  U(E, 'Vignette Heavy', VG(-55, 35, 50));
  U(E, 'Vignette White', VG(30, 40, 70));
  U(E, 'Vignette Off', VG(0));
  U(E, 'Grain Fine', GR(15, 15, 40));
  U(E, 'Grain Medium', GR(30, 30, 55));
  U(E, 'Grain Heavy', GR(55, 50, 70));
  U(E, 'Grain Off', GR(0));
  U(K, 'Linear', { curve: { master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, curveParam: { highlights: 0, lights: 0, darks: 0, shadows: 0 } });
  U(K, 'Medium Contrast', SC(0.04));
  U(K, 'Strong Contrast', SC(0.08));
  U(K, 'Matte Fade', MATTE(0.08, 0.03));
  U(K, 'Faded Blacks', FADE(0.12, 0));
  U(K, 'Rolled Highlights', FADE(0, 0.08));

  S.BUILTIN_PRESETS.push(...out);
})();
