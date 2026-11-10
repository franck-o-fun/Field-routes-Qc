// Field routes settings. Change these for another brand, distributor or agency.
window.FR_CONFIG = {
  // Where orders go. While testing: Francois only. For a real brand: the head-office inbox.
  orderEmail: "francois@magnoliamedia.ca",
  defaultRep: "Francois Demers",
  minimumOrder: 300,

  // GoHighLevel go-between on Render. Can also be typed in Reports > GoHighLevel.
  api: { url: "" },
  timeZone: "America/Toronto",

  // Cells of the brand's Excel order form (data/template.js holds the form itself).
  orderForm: {
    storeName: "D4",
    storeNumber: "E5",
    po: "D5",
    address: "G5",
    rep: "H5",
    contact: "D6",
    qtyColumn: "K",
    extraRow: 17            // first free row under the printed products
  },

  // price: dollars per unit (Tout-en-un) or per case (bars). row: line on the order form.
  products: [
    { id: "acai",      group: "Tout-en-un", by: "unit", name: "Açaï",                    size: "292 g", price: 37.04, row: 9 },
    { id: "framboise", group: "Tout-en-un", by: "unit", name: "Framboise",               size: "292 g", price: 37.04, row: 10 },
    { id: "ananas",    group: "Tout-en-un", by: "unit", name: "Ananas mangue",           size: "292 g", price: 37.04, row: 11 },
    { id: "vanille",   group: "Tout-en-un", by: "unit", name: "Protéine vanille",        size: "775 g", price: 45.59, row: 12 },
    { id: "chocolat",  group: "Tout-en-un", by: "unit", name: "Protéine chocolat",       size: "825 g", price: 45.59, row: 13 },
    { id: "b-choco",   group: "Bars",       by: "case", name: "Barre chocolat",          size: "60 g",  price: 33.24, row: 14 },
    { id: "b-arach",   group: "Bars",       by: "case", name: "Barre beurre d'arachide", size: "60 g",  price: 33.24, row: 15 },
    { id: "b-baies",   group: "Bars",       by: "case", name: "Barre baies d'été",       size: "60 g",  price: 33.24, row: 16 },
    // Not printed on the form yet: the row is added only when ordered, product codes left blank.
    { id: "b-caramel", group: "Bars",       by: "case", name: "Barre caramel salé",      size: "60 g",  price: 33.24, row: null,
      formLine: { description: "BARRE ÉNERGÉTIQUE À BASE D'ALIMENTS COMPLETS CARAMEL SALÉ", caseQty: 12, format: "60GR" } }
  ],

  // Free public services. Fine for one rep testing. Use your own keys or servers before a team rollout.
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoder: "https://nominatim.openstreetmap.org/search",
  router: "https://router.project-osrm.org",
  maxMapStops: 9
};
