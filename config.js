// La Run settings. Change these for another brand, distributor or agency.
window.FR_CONFIG = {
  defaultRep: "Francois Demers",

  // Name of the CRM as reps see it (white-label GoHighLevel).
  crmName: "La Run CRM",

  // CRM go-between on Render. Can also be typed in Reports > La Run CRM.
  api: { url: "" },
  timeZone: "America/Toronto",

  // Each company the rep sells for. The rep picks one before each order.
  companies: [
    {
      id: "reboot",
      name: "ReBoot",
      // Where orders go. While testing: Francois only. For a real brand: the head-office inbox.
      orderEmail: "francois@magnoliamedia.ca",
      minimum: 300,
      kind: "form",                       // short fixed list, each product on its own row of the form
      template: "ORDER_TEMPLATE_B64",     // template.js holds the brand's Excel form
      productFields: true,                // one "Qté ..." field per product on the GoHighLevel opportunity
      orderForm: { storeName: "D4", storeNumber: "E5", po: "D5", address: "G5", rep: "H5", contact: "D6", qtyColumn: "K", extraRow: 17 },
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
      ]
    },
    {
      id: "ecotrend",
      name: "Ecotrend",
      orderEmail: "francois@magnoliamedia.ca",   // replace with Ecotrend's order inbox
      minimum: 350,                              // Ecotrend minimum order, in dollars
      kind: "catalog",                           // full catalog read from the order form itself
      compact: true,                             // the sent Excel keeps only the ordered products
      // The Excel order form, as Ecotrend sends it. To update prices or products, replace this file.
      formFile: "ecotrend-form.xlsx",
      firstRow: 7,
      columns: { brand: "A", code: "B", name: "C", upc: "D", price: "E", srp: "F", map: "G" },
      orderForm: { storeName: "B3", contact: "E3", po: "H3", phone: "B4", email: "E4", rep: "H4", qtyColumn: "H" },
      productFields: false
    }
  ],

  // Free public services. Fine for one rep testing. Use your own keys or servers before a team rollout.
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoder: "https://nominatim.openstreetmap.org/search",
  router: "https://router.project-osrm.org",
  maxMapStops: 9
};
