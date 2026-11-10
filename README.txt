FIELD ROUTES - installable web app (no server code, no build step)

INSTALL
1. Upload everything in this folder to an HTTPS folder on your site,
   for example routes.francoisdemers.com/v2/ so your current build stays untouched.
   HTTPS is required for "Start from here" and for the Home Screen install.
2. On the iPhone, open that address in Safari, tap Share, then Add to Home Screen.
   The icon is named Routes.
3. First launch: leave the Map tab open a few minutes. Addresses are placed one per
   second (about 2 minutes for Rachelle Bery, 2 more for Comptes Quebec). Pins are
   then remembered on the phone.

WHAT TO EDIT
config.js          order email, minimum, products and prices, cells of the order form,
                   map / geocoder / router addresses
data/stores.js     the two store lists (name, address, region, store number, contact)
data/template.js   the brand's Excel order form, base64 encoded
sw.js              change VERSION after each upload so phones pick up the new files

WHERE DATA LIVES
Notes, photos, orders, kilometres and pins are saved on the device, filed under the rep
name shown at the top. Nothing is sent to a server. Reports > Download backup makes a
file you can restore on another phone. Real sign-in, shared data between teammates and
ClickUp / GoHighLevel sync need a backend: that is the next step, not in this version.

OUTSIDE SERVICES (free, public, fine for one rep testing)
Map tiles: OpenStreetMap.  Address lookup: Nominatim.  Driving time: OSRM demo server.
None has a service guarantee. Before a team rollout, point config.js at paid or
self-hosted equivalents.

ORDER FORM CELLS (config.js > orderForm)
Store name D4, store number E5, PO D5, address G5, rep H5, contact D6, quantities K9-K16.
Caramel sale is added on row 17 only when ordered, product codes blank.
