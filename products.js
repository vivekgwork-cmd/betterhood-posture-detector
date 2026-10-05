// Curated subset of the betterhood catalogue (shop.betterhood.in) that is relevant to posture.
// `fits` is shown to the AI so it can pick the product that matches what it sees in the photo.
const SHOP = 'https://shop.betterhood.in/products/';
const CDN = 'https://cdn.shopify.com/s/files/1/0924/0317/1697/files/';

const PRODUCTS = [
  {
    id: 'chair-lumbar',
    name: 'Lumbar Backrest Cushion for Chair',
    fits: 'Sitting on a chair/desk with a rounded or slumped lower back, no lumbar support, leaning away from the backrest.',
    price: 1357, mrp: 4199,
    url: SHOP + 'betterhood-back-support-cushion-for-chair',
    image: CDN + 'lumbar-backrest-cushion-for-chair-ergonomic-memory-foam-back-support-80055283941745.webp?v=1783970565&width=400',
  },
  {
    id: 'chair-combo',
    name: 'Ergonomic Seat & Lumbar Cushion Combo for Chairs',
    fits: 'Sitting with multiple problems at once: slumped lower back AND pelvis tucked under / sliding forward on the seat, long work-from-home or office hours.',
    price: 2549, mrp: 8598,
    url: SHOP + 'betterhood-back-support-and-seat-cushion-for-chair-combo',
    image: CDN + 'chair-cushions-combo-ergonomic-memory-foam-backrest-seat-cushion-80055353704817.webp?v=1783970102&width=400',
  },
  {
    id: 'chair-coccyx',
    name: 'Coccyx Memory Foam Seat Cushion for Chair',
    fits: 'Sitting slouched on the tailbone, pelvis tilted backwards, perched on the edge of the seat, uneven hips while seated.',
    price: 1358, mrp: 4399,
    url: SHOP + 'betterhood-coccyx-seat-cushion-for-chair',
    image: CDN + 'coccyx-memory-foam-chair-cushion-for-seat-ergonomic-design-80055423762801.webp?v=1783970196&width=400',
  },
  {
    id: 'back-belt',
    name: 'LS Back Pain Belt with 8 Stabilizers',
    fits: 'Standing or walking with a hunched or swayed lower back, lifting/bending badly, standing posture problems.',
    price: 1399, mrp: 1999,
    url: SHOP + 'lumbar-support-belt',
    image: CDN + 'New_Listing_Graphics_14.png?v=1788189588&width=400',
  },
  {
    id: 'cervical-pillow',
    name: 'Cervical Pillow for Posture (Dual Height)',
    fits: 'Lying down / sleeping / lounging on a sofa or bed with the neck bent at an awkward angle, or head propped too high.',
    price: 1358, mrp: 3999,
    url: SHOP + 'betterhood-cervical-neck-support-pillow-for-sleeping',
    image: CDN + '71FFFdI8PgL._SL1500.webp?v=1784011916&width=400',
  },
  {
    id: 'car-lumbar',
    name: 'Lumbar Backrest Cushion for Car',
    fits: 'Driving or sitting in a car seat with a slumped lower back.',
    price: 1457, mrp: 3799,
    url: SHOP + 'betterhood-car-backrest-cushion',
    image: CDN + 'lumbar-backrest-cushion-for-car-ergonomic-memory-foam-back-support-80055123738993.webp?v=1783970512&width=400',
  },
  {
    id: 'car-combo',
    name: 'Car Seat Cushion 3-in-1 Combo (Backrest, Headrest, Seat)',
    fits: 'In a car with head poking forward AND a slumped back, i.e. several issues while driving or travelling.',
    price: 2989, mrp: 10697,
    url: SHOP + 'betterhood-car-backrest-headrest-and-seat-cushion-combo',
    image: CDN + 'car-seat-cushion-3-in-1-combo-backrest-headrest-and-seat-80055179182449.webp?v=1783970014&width=400',
  },
  {
    id: 'roll-on',
    name: 'Back, Neck & Shoulder Pain Recovery Roll-On',
    fits: 'Forward head / "tech neck" from looking down at a phone or laptop, rounded or hunched shoulders, visible neck and shoulder strain in a setting where a cushion does not apply (standing, phone use, on the move).',
    price: 998, mrp: 1497,
    url: SHOP + 'pain-relief-and-recovery-roll-on',
    image: CDN + 'betterhood-pain-relief-and-recovery-roll-on-50-ml-77863986921841.webp?v=1783969591&width=400',
  },
];

const byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

module.exports = { PRODUCTS, byId };
