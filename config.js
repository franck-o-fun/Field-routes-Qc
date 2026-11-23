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
      // upc / upcCase: barcodes from the ReBoot form (UPC EA and UPC CS columns), used by Scan.
      products: [
        { id: "acai",      group: "Tout-en-un", by: "unit", name: "Açaï",                    size: "292 g", price: 37.04, row: 9, upc: "628634929117", upcCase: "62863492929118" },
        { id: "framboise", group: "Tout-en-un", by: "unit", name: "Framboise",               size: "292 g", price: 37.04, row: 10, upc: "628634929162", upcCase: "6286349292014" },
        { id: "ananas",    group: "Tout-en-un", by: "unit", name: "Ananas mangue",           size: "292 g", price: 37.04, row: 11, upc: "628634929155", upcCase: "62863492929156" },
        { id: "vanille",   group: "Tout-en-un", by: "unit", name: "Protéine vanille",        size: "775 g", price: 45.59, row: 12, upc: "628634929209", upcCase: "62863492939209" },
        { id: "chocolat",  group: "Tout-en-un", by: "unit", name: "Protéine chocolat",       size: "825 g", price: 45.59, row: 13, upc: "628634929254", upcCase: "62863492939254" },
        { id: "b-choco",   group: "Bars",       by: "case", name: "Barre chocolat",          size: "60 g",  price: 33.24, row: 14, upc: "6286349290102", upcCase: "6286349291000" },
        { id: "b-arach",   group: "Bars",       by: "case", name: "Barre beurre d'arachide", size: "60 g",  price: 33.24, row: 15, upc: "6286349290119", upcCase: "6286349290010" },
        { id: "b-baies",   group: "Bars",       by: "case", name: "Barre baies d'été",       size: "60 g",  price: 33.24, row: 16, upc: "6286349290126", upcCase: "6286349290027" },
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
    },
    {
      id: "mooz",
      name: "MOOZ",
      orderEmail: "francois@magnoliamedia.ca",   // replace with the MOOZ order inbox
      minimum: 0,                                // no minimum order
      kind: "form",                              // short fixed list, each product on its own row of the form
      // The MOOZ Excel order form. To change prices or layout, replace this file (same name) and keep the rows below in line.
      formFile: "mooz-form.xlsx",
      productFields: false,
      orderForm: { storeName: "A6", date: "D6", po: "F6", contact: "A8", phone: "D8", email: "F8", address: "A10", storeNumber: "D10", rep: "F10", qtyColumn: "G",
        lineTotal: "H", totals: { units: "H22", subtotal: "H23", gst: "H24", qst: "H25", total: "H26", gstRate: 0.05, qstRate: 0.09975 } },
      // price: dollars per unit (same price for the whole line). srp: PDSF. row: line on the order form.
      products: [
        { id: "mz-epinette", group: "Déodorant probiotique", by: "unit", name: "Épinette & eucalyptus", size: "75 g", price: 11.40, srp: 18.99, row: 14 },
        { id: "mz-menthe",   group: "Déodorant probiotique", by: "unit", name: "Menthe & orange",       size: "75 g", price: 11.40, srp: 18.99, row: 15 },
        { id: "mz-cedre",    group: "Déodorant probiotique", by: "unit", name: "Cèdre & agrumes",       size: "75 g", price: 11.40, srp: 18.99, row: 16 },
        { id: "mz-lavande",  group: "Déodorant probiotique", by: "unit", name: "Lavande & eucalyptus",  size: "75 g", price: 11.40, srp: 18.99, row: 17 },
        { id: "mz-poivre",   group: "Déodorant probiotique", by: "unit", name: "Poivre & bergamote",    size: "75 g", price: 11.40, srp: 18.99, row: 18 },
        { id: "mz-lime",     group: "Déodorant probiotique", by: "unit", name: "Lime & sapin baumier",  size: "75 g", price: 11.40, srp: 18.99, row: 19 },
        { id: "mz-sansodeur",group: "Déodorant probiotique", by: "unit", name: "Sans odeur",            size: "75 g", price: 11.40, srp: 18.99, row: 20 }
      ]
    }
  ],

  // Free public services. Fine for one rep testing. Use your own keys or servers before a team rollout.
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoder: "https://nominatim.openstreetmap.org/search",
  router: "https://router.project-osrm.org",
  maxMapStops: 9
};
