/* Verbiest — interface languages (English, French).
   Loaded before util.js and app.js. The language is chosen in the app (saved on the
   device) or, the first time, from the browser's language. */
(function () {
  "use strict";
  let saved = null;
  try { saved = localStorage.getItem("verbiest-lang"); } catch (e) { /* storage unavailable */ }
  const lang = saved === "fr" || saved === "en" ? saved : (/^fr\b/i.test(navigator.language || "") ? "fr" : "en");
  document.documentElement.lang = lang;

  const pl = (n, one, many) => (Math.abs(n) <= 1 ? one : many);       // French: 0 and 1 are singular
  const plEn = (n, one, many) => (n === 1 ? one : many);

  /* ------------------------------------------------------------- English */
  const EN = {
    "meta.title": "Verbiest — A visual history of the automobile",
    "nav.home": "Verbiest, back to the timeline",
    "theme.label": "Switch between light and dark appearance",
    "theme.title": "Appearance",
    "lang.label": "Language",
    "lang.en": "English",
    "lang.fr": "Français",
    "tab.timeline": "Timeline", "tab.milestones": "Milestones", "tab.makers": "Makers", "tab.garage": "Garage",
    "tab.search": "Search", "tab.search.title": "Search (/)", "tabs.label": "Sections",
    "title.timeline": "Timeline", "title.milestones": "Milestones", "title.makers": "Makers", "title.garage": "My Garage", "title.search": "Search",
    "timeline.eyebrow": "A visual history of the automobile",
    "loading": "Loading the archive…",
    "seg.models": "Models", "seg.makers": "Makers",
    "seg.byCountry": "By Country", "seg.country": "Country", "seg.byBody": "By Body Style", "seg.body": "Body",
    "aria.metric": "What to count", "aria.colour": "Colour the bars by", "aria.kind": "Kind of car", "aria.eras": "Jump to an era",
    "aria.chart": "Histogram of cars per year. Use the arrow keys to move between years.",
    "aria.overview": "Zoom window: drag it, or drag its handles",
    "aria.zoom": "Zoom", "aria.zoomOut": "Zoom out", "aria.zoomIn": "Zoom in",
    "play": "Play", "pause": "Pause", "play.title": "Step through the years",
    "table.show": "Show Data Table", "table.hide": "Hide Data Table",
    "sort": "Sort", "sort.title": "Sort order", "sort.fame": "Most Famous", "sort.year": "Oldest First", "sort.name": "Name",
    "more": "Show More", "moreN": (n) => `Show More (${n})`,
    "ms.lede": "The moments that shaped the automobile, era by era. Open one to read its story.",
    "ms.eyebrow": (n, a, b) => `${n} moments · ${a}–${b}`,
    "makers.search": "Search Makers", "makers.searchLabel": "Search makers", "clear": "Clear",
    "makers.group": "Group makers", "makers.az": "A–Z", "makers.country": "Country", "makers.founded": "Founded", "makers.groups": "Groups",
    "own.cap": "Who owns whom in", "own.major": "Major", "own.all": "All", "own.scope": "Which groups to show",
    "own.year": "Year", "own.prev": "One year earlier", "own.next": "One year later", "own.step": "Step one year",
    "own.branches": "Regional branches", "own.play.title": "Play through the years",
    "own.note": "From Wikidata’s “owned by”, “parent organisation” and “subsidiary” statements (majority owners only; governments left out), plus a short list of well-known acquisitions. Dashed lines: the start year is not recorded, so it is estimated. Tap any company for its story.",
    "garage.eyebrow": "Saved on this device",
    "garage.lede": "The cars you have owned and the ones you love. Open any car and tap <b>Favourite</b> or <b>I Owned One</b>.",
    "search.placeholder": "Cars, Makers and Years", "search.label": "Search cars, makers and years", "search.results": "Search results",
    "footer.data": "Data from <a href=\"https://en.wikipedia.org/\" target=\"_blank\" rel=\"noopener\">Wikipedia</a> and <a href=\"https://www.wikidata.org/\" target=\"_blank\" rel=\"noopener\">Wikidata</a>. Text CC BY-SA 4.0; images from Wikimedia Commons under their own licences.",
    "footer.dedication": "Named after Ferdinand Verbiest (1623–1688), the Flemish Jesuit who built a small steam-powered trolley around 1672, possibly the first self-propelled vehicle.",
    "footer.snapshot": (d) => `Snapshot taken ${d}.`,
    "back": "Back", "close": "Close",

    // intro & readout
    "intro": (cars, makers) => `${cars} car models and ${makers} makers from Wikipedia, year by year — from Ferdinand Verbiest’s steam trolley of 1672 to today’s electric cars. `,
    "intro.touch": "Tap a bar to see that year’s cars.",
    "intro.mouse": "Hover a bar to peek, click it to see that year’s cars.",
    "stat.cars": "Car models", "stat.makers": "Makers", "stat.countries": "Countries", "stat.years": "Years",
    "ro.makers": "Makers founded", "ro.models": "New models", "ro.makerModels": (m) => `New ${m} models`,
    "ro.none": "Nothing in this period",
    "unit.maker": (n) => plEn(n, "maker", "makers"), "unit.model": (n) => plEn(n, "model", "models"),
    "today": "Today", "todayLc": "today",
    "kind.all": "All Cars", "kind.fav": "Favourites", "kind.owned": "My Cars", "kind.ownedLong": "Cars I’ve Owned",
    "eras.all": "All Years",
    "hint.touch": "Swipe the chart to travel through time and pinch to zoom. Tap a bar for its cars, or touch and hold, then slide, to scrub through the years.",
    "hint.mouse": "Drag the chart or the frame below it to travel through time · ⌘/Ctrl + scroll or double-click to zoom · click a bar to pick a year · ← → step through years.",
    "legend.show": (g) => `Show ${g}`, "legend.hide": (g) => `Hide ${g} (Shift-click to show only ${g})`,
    "tt.makersFounded": (n) => plEn(n, "maker founded", "makers founded"), "tt.newModels": (n) => plEn(n, "new model", "new models"),
    "tt.notable": "Notable: ", "tt.andMore": (n) => ` and ${n} more`,
    "tt.selTouch": "Selected · the list is below", "tt.selMouse": "Selected · click again to clear",
    "tt.seeTouch": "Tap to see them all", "tt.seeMouse": "Click to see them all",
    "tt.readTouch": "Tap to read more", "tt.readMouse": "Click to read more",
    "compressed": "compressed scale",

    // results
    "res.makersFounded": "Makers Founded", "res.makerModels": (m) => `${m} Models`, "res.cars": "Cars Introduced",
    "res.in": (noun, y) => `${noun} in ${y}`, "res.range": (noun, a, b) => `${noun}, ${a}–${b}`,
    "res.count": (n, makersMode) => `${n} ${makersMode ? plEn(+String(n).replace(/\D/g, ""), "maker", "makers") : plEn(+String(n).replace(/\D/g, ""), "model", "models")}`,
    "res.sort.fame": "most famous first", "res.sort.year": "oldest first", "res.sort.name": "by name",
    "res.follows": " · follows the chart",
    "res.learnMore": "Learn More on Wikipedia",
    "noResults": "No Results",
    "res.noneYear": (makersMode, y) => `No ${makersMode ? "makers founded" : "cars introduced"} in ${y} match the current filters.`,
    "res.nonePeriod": "Nothing matches the current filters in this period.",
    "tok.remove": (l) => `Remove filter: ${l}`,
    "tok.hiding": (list) => `Hiding ${list}`, "tok.nCountries": (n) => `${n} countries`, "tok.nBodies": (n) => `${n} body styles`,
    "tok.year": (y) => `Year ${y}`,
    "table.year": "Year", "table.total": "Total",
    "nModels": (n) => `${n} ${plEn(n, "model", "models")}`, "nCars": (n) => `${n} ${plEn(n, "car", "cars")}`, "nMakers": (n) => `${n} ${plEn(n, "maker", "makers")}`,
    "unknownCountry": "Unknown country",

    // detail pages
    "info.introduced": "Introduced", "info.until": (y) => `until ${y}`, "info.modelYear": "model year",
    "info.maker": "Maker", "info.makerLabel": (m) => `Maker: ${m}`, "info.country": "Country", "info.body": "Body", "info.style": "style",
    "info.production": "Production", "info.years": "years", "info.wikipedia": "Wikipedia",
    "info.language": (n) => plEn(n, "language", "languages"),
    "info.founded": "Founded", "info.yearsAgo": (n) => `${n} years ago`, "info.closed": "Closed", "info.status": "Status", "info.active": "Active",
    "info.after": (n) => `after ${n} years`, "info.models": "Models", "info.onWikipedia": "on Wikipedia",
    "info.year": "Year", "info.era": "Era", "info.milestone": "Milestone", "info.of": (n) => `of ${n}`,
    "info.owned": "Owned", "info.owners": "Owners", "info.overTime": "over time", "info.company": (n) => plEn(n, "company", "companies"),
    "see": (y) => `See ${y}`, "timelineBtn": "Timeline", "groupsBtn": "Groups", "seeAll": "See All",
    "wiki": "Wikipedia", "wikimedia": "Wikimedia",
    "sec.inHistory": (m) => `In ${m}’s History`, "sec.placeInHistory": "Place in History",
    "note.ribbonMaker": (m) => `Production years, with ${m}’s other models as dots.`, "note.ribbon": "Production years on the full timeline.",
    "sec.moreFrom": (m) => `More from ${m}`, "sec.alsoNew": (y) => `Also New in ${y}`,
    "sec.generations": "Generations", "sec.family": (m) => `Part of the ${m} family`,
    "link.read": "Read on Wikipedia", "link.photo": "Photo on Wikimedia Commons", "link.image": "Image on Wikimedia Commons",
    "src.car": "Text from Wikipedia (CC BY-SA 4.0). Facts from Wikipedia categories and Wikidata.",
    "src.text": "Text from Wikipedia (CC BY-SA 4.0).",
    "src.company": "Ownership from Wikidata (CC0); text from Wikipedia (CC BY-SA 4.0).",
    "sec.perYear": "New Models per Year", "note.barTouch": "Tap a bar to see that year on the timeline.", "note.barMouse": "Click a bar to see that year on the timeline.",
    "sec.about": "About", "sec.models": "Models", "showAllModels": (n) => `Show All ${n} Models`, "showAll": (n) => `Show All ${n}`,
    "ms.eyebrowYear": (y) => `Milestone · ${y}`, "prev": "Previous", "next": "Next",
    "company": "Company", "companyYears": (a, b) => `Company · ${a}–${b}`,

    // Wikipedia text
    "art.loading": "Loading the article from Wikipedia…",
    "art.offline": "Could not reach Wikipedia, so only the short description is shown.",
    "art.none": "No text available.",
    "art.full": "Read the Full Article",
    "art.meta": (sections, minutes) => `${sections} ${plEn(sections, "section", "sections")} · ${minutes} min read`,
    "art.englishOnly": "",
    "art.title": "Article",
    "art.source": (lang) => `Wikipedia · ${lang === "fr" ? "French" : "English"}`,
    "art.open": "Open on Wikipedia",
    "art.licence": "Text from Wikipedia, available under CC BY-SA 4.0. Tables, images and references are left out; open the article on Wikipedia to see them.",
    "art.skip": ["references", "notes", "see also", "external links", "further reading", "bibliography", "sources", "gallery", "citations", "footnotes", "notes and references", "explanatory notes"],
    "textMore": "more",

    // ownership
    "own.since": (y) => `since ${y}`, "own.about": (y) => `c. ${y}`,
    "own.ownedBy": (o, span) => `Owned by ${o} ${span}`,
    "own.summary": (g, n, big) => `${g} ${plEn(g, "group", "groups")} · ${n} companies owned` + (big ? ` · largest: ${big}` : ""),
    "own.noneYear": "No ownership links recorded for this year",
    "own.count": (n, l) => `${n} companies · ${l} ownership links`,
    "own.noGroups": "No Groups Yet", "own.noMajor": "No group owned three or more companies this year. Try “All”.", "own.noLinks": "No ownership links are recorded for this year.",
    "own.ownersOverTime": "Owners Over Time", "own.seeInGroups": "See in Groups",
    "own.ownersNote": "Who controlled the company, from Wikidata. “c.” marks an estimated start year.",
    "own.itOwned": "Companies It Owned",
    "own.subOf": (n, o) => `${n} (owned by ${o})`,

    // makers tab
    "makers.unknownFounding": "Founding year unknown", "makers.foundedIn": (d) => `Founded in the ${d}s`,
    "makers.countOf": (a, b) => `${a} of ${b} makers`, "makers.count": (a, c) => `${a} makers · ${c} countries`,
    "makers.none": (q) => `No makers match “${q}”.`,

    // garage
    "g.saveFail": "Couldn’t save on this device",
    "g.favAdded": "Added to Favourites", "g.favRemoved": "Removed from Favourites",
    "g.ownAdded": "Added to My Garage", "g.ownRemoved": "Removed from My Garage",
    "g.favourite": "Favourite", "g.favouriteMaker": "Favourite Maker", "g.inGarage": "In My Garage", "g.ownedOne": "I Owned One",
    "g.ownedFrom": "Owned from", "g.until": "Until", "g.yearPh": "Year", "g.stillOwn": "Still own it",
    "g.notePh": "A note — e.g. “Our family car, bought new in 1972”", "g.note": "Note",
    "g.formFoot": "Saved on this device. Your cars make up your car story in the Garage tab.",
    "g.since": (y) => `since ${y}`, "g.until2": (y) => `until ${y}`, "g.owned": (y) => `Owned ${y}`, "g.yearsNotSet": "Purchase date not set",
    "g.empty": "Your Garage Is Empty",
    "g.emptyText": "Open any car and tap <b>I Owned One</b> to build the story of the cars in your life, or <b>Favourite</b> to keep the ones you love.",
    "g.findCar": "Find a Car", "g.browse": "Browse the Timeline",
    "g.ownedHead": "Cars I’ve Owned", "g.favCars": "Favourite Cars", "g.favMakers": "Favourite Makers", "g.showOnTimeline": "Show on Timeline",
    "g.hint": "Add when you bought each car to see your car story here.",
    "g.backup": "Backup", "g.export": "Export Backup…", "g.import": "Import Backup…",
    "g.backupNote": "Your garage is stored only on this device, in this browser. On iPhone and iPad, add Verbiest to your Home Screen so Safari keeps it, and export a backup to move it to another device.",
    "g.backupSaved": "Backup saved", "g.backupTitle": "Verbiest garage backup",
    "g.imported": (n) => `Imported ${n} ${plEn(n, "item", "items")}`, "g.upToDate": "Already up to date", "g.badFile": "That file isn’t a Verbiest backup",
    "g.inGarageTitle": "In my garage",
    "g.inGarageN": (n) => `In My Garage (${n})`,
    "g.boughtIn": "Bought in", "g.pricePaid": "Price paid", "g.soldQ": "Sold", "g.soldIn": "Sold in", "g.salePrice": "Sale price",
    "g.month": "Month", "g.monthAny": "Month", "g.amountPh": "Amount", "g.currency": "Currency",
    "cur.EUR": "€ euros", "cur.FRF": "F French francs", "cur.AF": "AF old French francs", "cur.BEF": "BF Belgian francs",
    "cur.CHF": "CHF Swiss francs", "cur.GBP": "£ pounds", "cur.USD": "$ dollars",
    "g.euros": (e) => `≈ ${e} at the official euro rate`,
    "g.addAnother": "I Owned Another One", "g.delete": "Remove from My Garage",
    "g.deleteConfirm": (n) => `Remove this ${n} from your garage?`,
    "g.ownership": (k) => `Car ${k}`, "g.boughtOn": (d) => `Bought ${d}`,
    "g.storyHead": "My Car Story", "g.storySummary": (n, y) => `${n} ${plEn(n, "car", "cars")}` + (y ? ` since ${y}` : ""),
    "g.toComplete": "Dates to Add", "g.toCompleteNote": "Open each car to add when you bought it.",
    "g.jBought": "Bought", "g.jSold": "Sold", "g.jStill": "Still in my garage", "g.after": (d) => `after ${d}`,
    "dur.years": (n) => `${n} ${plEn(n, "year", "years")}`, "dur.months": (n) => `${n} ${plEn(n, "month", "months")}`,
    "sale.head": "Find One for Sale", "sale.note": "Opens the site’s own search; the ads and prices are theirs.",
    "sale.lbc": "Ads on leboncoin", "sale.lbcSub": "France", "sale.web": "Search the Web", "sale.webSub": "Google",
    "sale.query": (n) => `${n} for sale`,

    // search
    "s.recent": "Recently Viewed", "s.suggestions": "Suggestions",
    "s.suggest": ["Ford Model T", "Citroën DS", "Volkswagen Beetle", "Ferrari", "1955", "Electric", "Rolls-Royce", "Mini"],
    "s.year": "Year", "s.makers": "Makers", "s.cars": "Cars", "s.goTo": (y) => `Go to ${y}`,
    "s.carsThatYear": (n) => `${n} ${plEn(+String(n).replace(/\D/g, ""), "car", "cars")} introduced that year`, "s.showYear": "Show this year on the timeline",
    "s.sinceY": (y) => `since ${y}`, "s.showing": (n) => `Showing the 25 most famous of ${n} matches.`,
    "s.noResults": "Check the spelling or try a new search.",
  };

  /* -------------------------------------------------------------- French */
  const FR = {
    "meta.title": "Verbiest — Une histoire visuelle de l’automobile",
    "nav.home": "Verbiest, retour à la chronologie",
    "theme.label": "Basculer entre l’apparence claire et sombre",
    "theme.title": "Apparence",
    "lang.label": "Langue",
    "tab.timeline": "Chronologie", "tab.milestones": "Jalons", "tab.makers": "Marques", "tab.garage": "Garage",
    "tab.search": "Rechercher", "tab.search.title": "Rechercher (/)", "tabs.label": "Sections",
    "title.timeline": "Chronologie", "title.milestones": "Jalons", "title.makers": "Marques", "title.garage": "Mon garage", "title.search": "Recherche",
    "timeline.eyebrow": "Une histoire visuelle de l’automobile",
    "loading": "Chargement des archives…",
    "seg.models": "Modèles", "seg.makers": "Marques",
    "seg.byCountry": "Par pays", "seg.country": "Pays", "seg.byBody": "Par carrosserie", "seg.body": "Carrosserie",
    "aria.metric": "Ce que l’on compte", "aria.colour": "Couleur des barres", "aria.kind": "Type de voiture", "aria.eras": "Aller à une époque",
    "aria.chart": "Histogramme des voitures par année. Utilisez les flèches pour changer d’année.",
    "aria.overview": "Fenêtre de zoom : faites-la glisser, ou tirez ses poignées",
    "aria.zoom": "Zoom", "aria.zoomOut": "Dézoomer", "aria.zoomIn": "Zoomer",
    "play": "Lecture", "pause": "Pause", "play.title": "Parcourir les années",
    "table.show": "Afficher le tableau des données", "table.hide": "Masquer le tableau des données",
    "sort": "Trier", "sort.title": "Ordre de tri", "sort.fame": "Les plus célèbres", "sort.year": "Les plus anciennes", "sort.name": "Nom",
    "more": "Afficher plus", "moreN": (n) => `Afficher plus (${n})`,
    "ms.lede": "Les moments qui ont façonné l’automobile, époque par époque. Ouvrez-en un pour lire son histoire.",
    "ms.eyebrow": (n, a, b) => `${n} moments · ${a}-${b}`,
    "makers.search": "Rechercher une marque", "makers.searchLabel": "Rechercher une marque", "clear": "Effacer",
    "makers.group": "Classer les marques", "makers.az": "A–Z", "makers.country": "Pays", "makers.founded": "Fondation", "makers.groups": "Groupes",
    "own.cap": "Qui possède qui en", "own.major": "Principaux", "own.all": "Tous", "own.scope": "Groupes affichés",
    "own.year": "Année", "own.prev": "Un an plus tôt", "own.next": "Un an plus tard", "own.step": "Changer d’année",
    "own.branches": "Filiales régionales", "own.play.title": "Faire défiler les années",
    "own.note": "D’après les déclarations « détenu par », « organisation mère » et « filiale » de Wikidata (actionnaires majoritaires uniquement, États exclus), complétées par une courte liste d’acquisitions connues. Traits pointillés : l’année de début n’est pas renseignée et a été estimée. Touchez une entreprise pour lire son histoire.",
    "garage.eyebrow": "Enregistré sur cet appareil",
    "garage.lede": "Les voitures que vous avez possédées et celles que vous aimez. Ouvrez une voiture et touchez <b>Favori</b> ou <b>Je l’ai eue</b>.",
    "search.placeholder": "Voitures, marques et années", "search.label": "Rechercher des voitures, des marques et des années", "search.results": "Résultats de recherche",
    "footer.data": "Données de <a href=\"https://fr.wikipedia.org/\" target=\"_blank\" rel=\"noopener\">Wikipédia</a> et de <a href=\"https://www.wikidata.org/\" target=\"_blank\" rel=\"noopener\">Wikidata</a>. Textes sous licence CC BY-SA 4.0 ; images de Wikimedia Commons sous leurs propres licences.",
    "footer.dedication": "Nommé d’après Ferdinand Verbiest (1623-1688), jésuite flamand qui construisit vers 1672 un petit chariot à vapeur, peut-être le premier véhicule automobile.",
    "footer.snapshot": (d) => `Données du ${d}.`,
    "back": "Retour", "close": "Fermer",

    "intro": (cars, makers) => `${cars} modèles de voitures et ${makers} marques tirés de Wikipédia, année par année — du chariot à vapeur de Ferdinand Verbiest en 1672 aux voitures électriques d’aujourd’hui. `,
    "intro.touch": "Touchez une barre pour voir les voitures de l’année.",
    "intro.mouse": "Survolez une barre pour un aperçu, cliquez pour voir les voitures de l’année.",
    "stat.cars": "Modèles", "stat.makers": "Marques", "stat.countries": "Pays", "stat.years": "Ans",
    "ro.makers": "Marques fondées", "ro.models": "Nouveaux modèles", "ro.makerModels": (m) => `Nouveaux modèles ${m}`,
    "ro.none": "Rien sur cette période",
    "unit.maker": (n) => pl(n, "marque", "marques"), "unit.model": (n) => pl(n, "modèle", "modèles"),
    "today": "Aujourd’hui", "todayLc": "aujourd’hui",
    "kind.all": "Toutes", "kind.fav": "Favoris", "kind.owned": "Mes voitures", "kind.ownedLong": "Mes voitures",
    "eras.all": "Toutes les années",
    "hint.touch": "Faites glisser le graphique pour voyager dans le temps et pincez pour zoomer. Touchez une barre pour voir ses voitures, ou maintenez puis glissez pour parcourir les années.",
    "hint.mouse": "Faites glisser le graphique ou le cadre en dessous pour voyager dans le temps · ⌘/Ctrl + molette ou double-clic pour zoomer · cliquez une barre pour choisir une année · ← → pour changer d’année.",
    "legend.show": (g) => `Afficher ${g}`, "legend.hide": (g) => `Masquer ${g} (Maj-clic pour n’afficher que ${g})`,
    "tt.makersFounded": (n) => pl(n, "marque fondée", "marques fondées"), "tt.newModels": (n) => pl(n, "nouveau modèle", "nouveaux modèles"),
    "tt.notable": "À retenir : ", "tt.andMore": (n) => ` et ${n} autres`,
    "tt.selTouch": "Sélectionnée · la liste est en dessous", "tt.selMouse": "Sélectionnée · cliquez à nouveau pour annuler",
    "tt.seeTouch": "Touchez pour toutes les voir", "tt.seeMouse": "Cliquez pour toutes les voir",
    "tt.readTouch": "Touchez pour en savoir plus", "tt.readMouse": "Cliquez pour en savoir plus",
    "compressed": "échelle compressée",

    "res.makersFounded": "Marques fondées", "res.makerModels": (m) => `Modèles ${m}`, "res.cars": "Voitures lancées",
    "res.in": (noun, y) => `${noun} en ${y}`, "res.range": (noun, a, b) => `${noun}, ${a}-${b}`,
    "res.count": (n, makersMode) => `${n} ${makersMode ? pl(+String(n).replace(/\D/g, ""), "marque", "marques") : pl(+String(n).replace(/\D/g, ""), "modèle", "modèles")}`,
    "res.sort.fame": "les plus célèbres d’abord", "res.sort.year": "les plus anciennes d’abord", "res.sort.name": "par nom",
    "res.follows": " · suit le graphique",
    "res.learnMore": "En savoir plus sur Wikipédia",
    "noResults": "Aucun résultat",
    "res.noneYear": (makersMode, y) => makersMode ? `Aucune marque fondée en ${y} ne correspond aux filtres.` : `Aucune voiture lancée en ${y} ne correspond aux filtres.`,
    "res.nonePeriod": "Rien ne correspond aux filtres sur cette période.",
    "tok.remove": (l) => `Retirer le filtre : ${l}`,
    "tok.hiding": (list) => `Masqués : ${list}`, "tok.nCountries": (n) => `${n} pays`, "tok.nBodies": (n) => `${n} carrosseries`,
    "tok.year": (y) => `Année ${y}`,
    "table.year": "Année", "table.total": "Total",
    "nModels": (n) => `${n} ${pl(n, "modèle", "modèles")}`, "nCars": (n) => `${n} ${pl(n, "voiture", "voitures")}`, "nMakers": (n) => `${n} ${pl(n, "marque", "marques")}`,
    "unknownCountry": "Pays inconnu",

    "info.introduced": "Lancement", "info.until": (y) => `jusqu’en ${y}`, "info.modelYear": "millésime",
    "info.maker": "Marque", "info.makerLabel": (m) => `Marque : ${m}`, "info.country": "Pays", "info.body": "Carrosserie", "info.style": "type",
    "info.production": "Production", "info.years": "ans", "info.wikipedia": "Wikipédia",
    "info.language": (n) => pl(n, "langue", "langues"),
    "info.founded": "Fondation", "info.yearsAgo": (n) => `il y a ${n} ans`, "info.closed": "Disparition", "info.status": "Statut", "info.active": "Active",
    "info.after": (n) => `après ${n} ans`, "info.models": "Modèles", "info.onWikipedia": "sur Wikipédia",
    "info.year": "Année", "info.era": "Époque", "info.milestone": "Jalon", "info.of": (n) => `sur ${n}`,
    "info.owned": "Possédées", "info.owners": "Propriétaires", "info.overTime": "au fil du temps", "info.company": (n) => pl(n, "entreprise", "entreprises"),
    "see": (y) => `Voir ${y}`, "timelineBtn": "Chronologie", "groupsBtn": "Groupes", "seeAll": "Tout voir",
    "wiki": "Wikipédia", "wikimedia": "Wikimedia",
    "sec.inHistory": (m) => `Dans l’histoire de ${m}`, "sec.placeInHistory": "Place dans l’histoire",
    "note.ribbonMaker": (m) => `Années de production, avec les autres modèles ${m} en points.`, "note.ribbon": "Années de production sur toute la chronologie.",
    "sec.moreFrom": (m) => `Autres modèles ${m}`, "sec.alsoNew": (y) => `Également lancées en ${y}`,
    "sec.generations": "Générations", "sec.family": (m) => `Fait partie de la famille ${m}`,
    "link.read": "Lire sur Wikipédia", "link.photo": "Photo sur Wikimedia Commons", "link.image": "Image sur Wikimedia Commons",
    "src.car": "Texte de Wikipédia (CC BY-SA 4.0). Informations tirées des catégories de Wikipédia et de Wikidata.",
    "src.text": "Texte de Wikipédia (CC BY-SA 4.0).",
    "src.company": "Propriétaires d’après Wikidata (CC0) ; texte de Wikipédia (CC BY-SA 4.0).",
    "sec.perYear": "Nouveaux modèles par année", "note.barTouch": "Touchez une barre pour voir cette année dans la chronologie.", "note.barMouse": "Cliquez une barre pour voir cette année dans la chronologie.",
    "sec.about": "À propos", "sec.models": "Modèles", "showAllModels": (n) => `Afficher les ${n} modèles`, "showAll": (n) => `Tout afficher (${n})`,
    "ms.eyebrowYear": (y) => `Jalon · ${y}`, "prev": "Précédent", "next": "Suivant",
    "company": "Entreprise", "companyYears": (a, b) => `Entreprise · ${a}-${b}`,

    "art.loading": "Chargement de l’article depuis Wikipédia…",
    "art.offline": "Impossible de joindre Wikipédia : seule la description courte est affichée.",
    "art.none": "Aucun texte disponible.",
    "art.full": "Lire l’article complet",
    "art.meta": (sections, minutes) => `${sections} ${pl(sections, "section", "sections")} · ${minutes} min de lecture`,
    "art.englishOnly": "Cette page n’existe qu’en anglais : le contenu est affiché en anglais.",
    "art.title": "Article",
    "art.source": (lang) => `Wikipédia · ${lang === "fr" ? "français" : "anglais"}`,
    "art.open": "Ouvrir sur Wikipédia",
    "art.licence": "Texte de Wikipédia, sous licence CC BY-SA 4.0. Les tableaux, images et références sont omis ; ouvrez l’article sur Wikipédia pour les voir.",
    "art.skip": ["notes et références", "références", "notes", "voir aussi", "liens externes", "lien externe", "bibliographie", "articles connexes", "annexes", "galerie", "sources", "source"],
    "textMore": "plus",

    "own.since": (y) => `depuis ${y}`, "own.about": (y) => `v. ${y}`,
    "own.ownedBy": (o, span) => `Propriété de ${o} ${span}`,
    "own.summary": (g, n, big) => `${g} ${pl(g, "groupe", "groupes")} · ${n} entreprises détenues` + (big ? ` · le plus grand : ${big}` : ""),
    "own.noneYear": "Aucun lien de propriété connu pour cette année",
    "own.count": (n, l) => `${n} entreprises · ${l} liens de propriété`,
    "own.noGroups": "Aucun groupe", "own.noMajor": "Aucun groupe ne possédait trois entreprises ou plus cette année. Essayez « Tous ».", "own.noLinks": "Aucun lien de propriété n’est connu pour cette année.",
    "own.ownersOverTime": "Propriétaires au fil du temps", "own.seeInGroups": "Voir dans Groupes",
    "own.ownersNote": "Qui contrôlait l’entreprise, d’après Wikidata. « v. » signale une année de début estimée.",
    "own.itOwned": "Entreprises détenues",
    "own.subOf": (n, o) => `${n} (propriété de ${o})`,

    "makers.unknownFounding": "Année de fondation inconnue", "makers.foundedIn": (d) => `Fondées dans les années ${d}`,
    "makers.countOf": (a, b) => `${a} marques sur ${b}`, "makers.count": (a, c) => `${a} marques · ${c} pays`,
    "makers.none": (q) => `Aucune marque ne correspond à « ${q} ».`,

    "g.saveFail": "Impossible d’enregistrer sur cet appareil",
    "g.favAdded": "Ajoutée aux favoris", "g.favRemoved": "Retirée des favoris",
    "g.ownAdded": "Ajoutée à mon garage", "g.ownRemoved": "Retirée de mon garage",
    "g.favourite": "Favori", "g.favouriteMaker": "Marque favorite", "g.inGarage": "Dans mon garage", "g.ownedOne": "Je l’ai eue",
    "g.ownedFrom": "Possédée de", "g.until": "Jusqu’en", "g.yearPh": "Année", "g.stillOwn": "Toujours à moi",
    "g.notePh": "Une note — par ex. « Notre voiture familiale, achetée neuve en 1972 »", "g.note": "Note",
    "g.formFoot": "Enregistré sur cet appareil. Vos voitures forment votre histoire automobile dans l’onglet Garage.",
    "g.since": (y) => `depuis ${y}`, "g.until2": (y) => `jusqu’en ${y}`, "g.owned": (y) => `Possédée ${y}`, "g.yearsNotSet": "Date d’achat non renseignée",
    "g.empty": "Votre garage est vide",
    "g.emptyText": "Ouvrez une voiture et touchez <b>Je l’ai eue</b> pour retracer les voitures de votre vie, ou <b>Favori</b> pour garder celles que vous aimez.",
    "g.findCar": "Trouver une voiture", "g.browse": "Parcourir la chronologie",
    "g.ownedHead": "Mes voitures", "g.favCars": "Voitures favorites", "g.favMakers": "Marques favorites", "g.showOnTimeline": "Voir dans la chronologie",
    "g.hint": "Indiquez quand vous avez acheté chaque voiture pour voir votre histoire automobile ici.",
    "g.backup": "Sauvegarde", "g.export": "Exporter une sauvegarde…", "g.import": "Importer une sauvegarde…",
    "g.backupNote": "Votre garage est enregistré uniquement sur cet appareil, dans ce navigateur. Sur iPhone et iPad, ajoutez Verbiest à l’écran d’accueil pour que Safari le conserve, et exportez une sauvegarde pour le transférer sur un autre appareil.",
    "g.backupSaved": "Sauvegarde enregistrée", "g.backupTitle": "Sauvegarde du garage Verbiest",
    "g.imported": (n) => `${n} ${pl(n, "élément importé", "éléments importés")}`, "g.upToDate": "Déjà à jour", "g.badFile": "Ce fichier n’est pas une sauvegarde Verbiest",
    "g.inGarageTitle": "Dans mon garage",
    "g.inGarageN": (n) => `Dans mon garage (${n})`,
    "g.boughtIn": "Achetée en", "g.pricePaid": "Prix payé", "g.soldQ": "Vendue", "g.soldIn": "Vendue en", "g.salePrice": "Prix de vente",
    "g.month": "Mois", "g.monthAny": "Mois", "g.amountPh": "Montant", "g.currency": "Monnaie",
    "cur.EUR": "€ euros", "cur.FRF": "F francs", "cur.AF": "AF anciens francs", "cur.BEF": "FB francs belges",
    "cur.CHF": "CHF francs suisses", "cur.GBP": "£ livres", "cur.USD": "$ dollars",
    "g.euros": (e) => `≈ ${e} au taux officiel de l’euro`,
    "g.addAnother": "J’en ai eu une autre", "g.delete": "Retirer de mon garage",
    "g.deleteConfirm": (n) => `Retirer cette ${n} de votre garage ?`,
    "g.ownership": (k) => `Voiture ${k}`, "g.boughtOn": (d) => `Achetée en ${d}`,
    "g.storyHead": "Mon histoire automobile", "g.storySummary": (n, y) => `${n} ${pl(n, "voiture", "voitures")}` + (y ? ` depuis ${y}` : ""),
    "g.toComplete": "Dates à compléter", "g.toCompleteNote": "Ouvrez chaque voiture pour indiquer quand vous l’avez achetée.",
    "g.jBought": "Achat", "g.jSold": "Vente", "g.jStill": "Toujours dans mon garage", "g.after": (d) => `après ${d}`,
    "dur.years": (n) => `${n} ${pl(n, "an", "ans")}`, "dur.months": (n) => `${n} mois`,
    "sale.head": "En trouver une à vendre", "sale.note": "Ouvre la recherche du site ; les annonces et les prix sont les leurs.",
    "sale.lbc": "Annonces sur leboncoin", "sale.lbcSub": "France", "sale.web": "Rechercher sur le web", "sale.webSub": "Google",
    "sale.query": (n) => `${n} occasion à vendre`,

    "s.recent": "Consultés récemment", "s.suggestions": "Suggestions",
    "s.suggest": ["Ford T", "Citroën DS", "Volkswagen Coccinelle", "Ferrari", "1955", "Renault 4", "Peugeot 205", "Mini"],
    "s.year": "Année", "s.makers": "Marques", "s.cars": "Voitures", "s.goTo": (y) => `Aller en ${y}`,
    "s.carsThatYear": (n) => `${n} ${pl(+String(n).replace(/\D/g, ""), "voiture lancée", "voitures lancées")} cette année-là`, "s.showYear": "Voir cette année dans la chronologie",
    "s.sinceY": (y) => `depuis ${y}`, "s.showing": (n) => `Les 25 plus célèbres sur ${n} résultats.`,
    "s.noResults": "Vérifiez l’orthographe ou essayez une autre recherche.",
  };

  /* ------------------------------------------------ data labels in French */
  const COUNTRIES = {
    "United States": "États-Unis", "China": "Chine", "Japan": "Japon", "United Kingdom": "Royaume-Uni", "Germany": "Allemagne",
    "France": "France", "Italy": "Italie", "South Korea": "Corée du Sud", "Sweden": "Suède", "Australia": "Australie", "India": "Inde",
    "Czechia": "Tchéquie", "Russia": "Russie", "Spain": "Espagne", "Malaysia": "Malaisie", "Morocco": "Maroc", "Romania": "Roumanie",
    "Brazil": "Brésil", "German Reich": "Reich allemand", "Hong Kong": "Hong Kong", "Iran": "Iran", "East Germany": "Allemagne de l’Est",
    "Switzerland": "Suisse", "Taiwan": "Taïwan", "Vietnam": "Viêt Nam", "Poland": "Pologne", "Soviet Union": "Union soviétique",
    "Austria–Hungary": "Autriche-Hongrie", "Czechoslovakia": "Tchécoslovaquie", "Austria": "Autriche", "Denmark": "Danemark",
    "Canada": "Canada", "Netherlands": "Pays-Bas", "Slovakia": "Slovaquie", "Latvia": "Lettonie", "Mexico": "Mexique",
    "Portugal": "Portugal", "Ukraine": "Ukraine", "Belgium": "Belgique", "Croatia": "Croatie", "Hungary": "Hongrie",
    "Indonesia": "Indonésie", "United Arab Emirates": "Émirats arabes unis", "Argentina": "Argentine", "Israel": "Israël",
    "Norway": "Norvège", "South Africa": "Afrique du Sud", "Thailand": "Thaïlande", "Turkey": "Turquie", "Finland": "Finlande",
    "Serbia": "Serbie", "Other countries": "Autres pays",
  };
  const BODIES = {
    "Sedan": ["Berline", "Berline"], "Hatchback": ["Berline à hayon", "Hayon"], "Estate / wagon": ["Break", "Break"],
    "Coupé & GT": ["Coupé et GT", "Coupé"], "Convertible & roadster": ["Cabriolet et roadster", "Cabriolet"],
    "SUV & off-road": ["SUV et tout-terrain", "SUV"], "Van, MPV & pickup": ["Utilitaire, monospace et pick-up", "Utilitaire"],
    "Not stated": ["Non précisé", "—"],
  };
  const BODY_SHORT_EN = { "Sedan": "Sedan", "Hatchback": "Hatchback", "Estate / wagon": "Estate", "Coupé & GT": "Coupé",
    "Convertible & roadster": "Convertible", "SUV & off-road": "SUV", "Van, MPV & pickup": "Van" };
  const KINDS = {
    sports: ["Voitures de sport", "Sportives, GT, roadsters, supercars, muscle cars"],
    luxury: ["Luxe", "Voitures de luxe, haut de gamme et limousines"],
    small: ["Petites voitures", "Citadines, microvoitures, kei cars, cyclecars"],
    electric: ["Électriques et hybrides", "Électriques, hybrides, hydrogène"],
    steam: ["Vapeur", "Voitures à vapeur"],
    racing: ["Course", "Voitures de course"],
    concept: ["Concept-cars", "Concept-cars et prototypes de salon"],
  };
  const ERA_LINK = "https://fr.wikipedia.org/wiki/Histoire_de_l%27automobile";
  const ERAS = {
    "Pioneers": ["Les pionniers", "Pionniers", "Chariots à vapeur, premières expériences électriques et premiers moteurs à combustion interne. Du petit chariot à vapeur de Verbiest au fardier de Cugnot et à l’Hippomobile de Lenoir, les inventeurs prouvent qu’un véhicule peut avancer par ses propres moyens — mais personne ne fabrique encore de voitures à vendre."],
    "Veteran era": ["Époque vétéran", "Vétéran", "La Patent-Motorwagen de Karl Benz ouvre l’ère de l’automobile pratique. Vapeur, électricité et essence se font concurrence, le volant remplace la barre franche, et les premières entreprises — Panhard et Levassor, Peugeot, Duryea, Oldsmobile — commencent à produire des voitures en série."],
    "Brass era": ["Époque du laiton", "Laiton", "Nommée d’après les phares et garnitures en laiton de l’époque (l’ère édouardienne en Grande-Bretagne). Le moteur à essence l’emporte, le moteur avant et la propulsion deviennent la norme, et la Ford T et la chaîne de montage mettent la voiture à la portée des familles ordinaires."],
    "Vintage era": ["Époque vintage", "Vintage", "De la fin de la Première Guerre mondiale au krach de Wall Street. Les carrosseries fermées remplacent les torpédos, les commandes se standardisent, les freins hydrauliques apparaissent et les marques de luxe rivalisent de moteurs toujours plus gros."],
    "Pre-war era": ["Avant-guerre", "Avant-guerre", "La Grande Dépression et la Seconde Guerre mondiale. De nombreux constructeurs disparaissent, tandis que l’aérodynamisme, les ailes intégrées, les suspensions indépendantes et la traction avant annoncent la voiture moderne."],
    "Post-war era": ["Après-guerre", "Après-guerre", "Reconstruction et motorisation de masse : carrosseries ponton, petites voitures économiques comme la Coccinelle, la 2 CV et la Mini, ailerons américains et muscle cars — puis les chocs pétroliers des années 1970 et l’essor des constructeurs japonais."],
    "Modern era": ["Époque moderne", "Moderne", "Partage de plateformes, électronique, normes de sécurité et d’émissions façonnent la voiture. Les SUV envahissent le monde et, au XXIᵉ siècle, hybrides et voitures électriques passent de la niche au grand public."],
  };
  const TAGS = {
    "City car": "Citadine", "Compact": "Compacte", "Concept car": "Concept-car", "Convertible": "Cabriolet", "Coupé": "Coupé",
    "Crossover SUV": "SUV crossover", "Cyclecar": "Cyclecar", "Electric": "Électrique", "Executive car": "Routière",
    "Flagship": "Haut de gamme", "Fuel cell": "Pile à combustible", "Grand tourer": "Grand tourisme", "Hatchback": "Berline à hayon",
    "Hot hatch": "Compacte sportive", "Hybrid": "Hybride", "Hydrogen": "Hydrogène", "Kei car": "Kei car", "Limousine": "Limousine",
    "Luxury": "Luxe", "Microcar": "Microvoiture", "Mid-size": "Familiale", "Minivan": "Monospace", "Muscle car": "Muscle car",
    "Off-roader": "Tout-terrain", "Personal luxury car": "Coupé de luxe", "Pickup truck": "Pick-up", "Plug-in hybrid": "Hybride rechargeable",
    "Pony car": "Pony car", "Racing car": "Voiture de course", "Roadster": "Roadster", "SUV": "SUV", "Sedan": "Berline",
    "Sport compact": "Compacte sport", "Sports car": "Voiture de sport", "Sports sedan": "Berline sportive", "Station wagon": "Break",
    "Steam": "Vapeur", "Subcompact": "Citadine polyvalente", "Taxi": "Taxi", "Three-wheeler": "Tricycle", "Van": "Fourgon",
  };
  const MILESTONES = {
    1672: ["Le chariot à vapeur de Verbiest", "Missionnaire jésuite flamand (1623-1688)"],
    1769: ["Le fardier à vapeur de Cugnot", "Inventeur français (1725-1804)"],
    1801: ["Le Puffing Devil de Trevithick", "Inventeur et ingénieur des mines britannique (1771-1833)"],
    1807: ["La voiture à hydrogène de De Rivaz", "Inventeur et homme politique suisse (1752-1828)"],
    1863: ["L’Hippomobile de Lenoir", "Automobile inventée par l’ingénieur belgo-français Étienne Lenoir en 1863"],
    1881: ["Le tricycle électrique de Trouvé", "Ingénieur électricien et inventeur français"],
    1886: ["La Benz Patent-Motorwagen", "Première automobile moderne"],
    1888: ["Le long voyage de Bertha Benz", "Pionnière allemande de l’automobile, épouse de Carl Benz"],
    1894: ["La première compétition automobile", "Paris-Rouen, première course automobile du monde"],
    1899: ["Première voiture à dépasser 100 km/h", "La Jamais Contente, voiture électrique de Camille Jenatzy"],
    1901: ["La première voiture « moderne »", "La Mercedes 35 HP"],
    1908: ["La Ford T", "Voiture américaine (1908-1927)"],
    1913: ["La chaîne de montage mobile", "Procédé de fabrication"],
    1923: ["Les premières 24 Heures du Mans", "Première édition de la course d’endurance"],
    1934: ["Traction avant et monocoque", "La Citroën Traction Avant"],
    1938: ["La Volkswagen Coccinelle", "Petite voiture familiale (1938-2003)"],
    1948: ["La Citroën 2 CV", "Petite voiture de Citroën (1948-1990)"],
    1950: ["La première saison de Formule 1", "Saison inaugurale du championnat du monde"],
    1955: ["La Citroën DS", "Routière de Citroën"],
    1959: ["La Mini", "Marque automobile britannique"],
    1964: ["La Ford Mustang", "Première génération"],
    1966: ["La Toyota Corolla", "Compacte japonaise"],
    1973: ["Le premier choc pétrolier", "Embargo pétrolier de l’OPAEP"],
    1974: ["La Volkswagen Golf", "Première génération de la compacte Golf"],
    1997: ["La Toyota Prius, l’hybride grand public", "Compacte hybride de Toyota"],
    2008: ["La Tesla Roadster", "Roadster électrique (2008-2012)"],
    2023: ["Une voiture électrique devient la plus vendue au monde", "La Tesla Model Y, SUV compact électrique"],
  };

  const dict = lang === "fr" ? FR : EN;
  function t(key, ...args) {
    let v = dict[key];
    if (v === undefined) v = EN[key];
    if (v === undefined) return key;
    return typeof v === "function" ? v(...args) : v;
  }

  /** Translate static markup: data-i18n (text), data-i18n-html (trusted markup from this file), data-i18n-attr="attr:key;attr:key". */
  function applyStatic(root) {
    root = root || document;
    for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.dataset.i18nAttr.split(";")) {
        const [attr, key] = pair.split(":");
        if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
      }
    }
    document.title = t("meta.title");
  }

  /** Put French names on the dataset's labels (countries, body styles, kinds, eras, tags, milestones). */
  function localizeData(D) {
    for (const g of D.dims.body.groups) g.short = lang === "fr" ? (BODIES[g.n] || [g.n, g.n])[1] : (BODY_SHORT_EN[g.n] || g.n);
    if (lang !== "fr") return;
    for (const c of D.countries) { c.en = c.n; c.n = COUNTRIES[c.n] || c.n; }
    for (const g of D.dims.country.groups) g.n = COUNTRIES[g.n] || g.n;
    for (const g of D.dims.body.groups) g.n = (BODIES[g.n] || [g.n])[0];
    for (const k of D.kinds) if (KINDS[k.k]) { k.n = KINDS[k.k][0]; k.hint = KINDS[k.k][1]; }
    for (const e of D.eras) {
      const fr = ERAS[e.name];
      if (fr) { e.name = fr[0]; e.short = fr[1]; e.text = fr[2]; e.link = ERA_LINK; }
    }
    D.tags = D.tags.map((x) => TAGS[x] || x);
    for (const m of D.milestones) {
      const fr = MILESTONES[m.year];
      if (fr) { m.labelEn = m.label; m.label = fr[0]; m.s = fr[1]; }
    }
    // French titles and descriptions from the build (cars, makers)
    for (const c of D.cars) { if (c.sf) c.s = c.sf; else if (c.s) c.s = null; }
    for (const m of D.makers) { if (m.sf) m.s = m.sf; else if (m.s) m.s = null; }
  }

  function setLang(l) {
    try { localStorage.setItem("verbiest-lang", l); } catch (e) { /* ignore */ }
    location.reload();
  }

  const dateFmt = (iso) => {
    try { return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00")); }
    catch (e) { return iso; }
  };

  window.I18N = { lang, t, applyStatic, localizeData, setLang, dateFmt, langs: [["en", "English"], ["fr", "Français"]] };
})();
