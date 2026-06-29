// ================================================
// script.js — Logique de la carte RPA Laurentides
// ================================================


// --- Fichiers de données ---
const FICHIERS = {
  mrc:          "data/mrc_laurentides.geojson",
  residences:   "data/residences.geojson",
  zones:        "data/zone_desserte.geojson",
  alimentation: "data/alimentation.geojson",
  sante:        "data/sante.geojson",
  parcs:        "data/parcs_laurentide.geojson",
  loisirs:      "data/loisirs_socialisation.geojson",
  services:     "data/services_complementaires.geojson",
  transport:    "data/transport_commun.geojson"
};

// --- Catégories d'équipements : nom affiché + couleur sur la carte + emoji dans le panneau ---
const CATEGORIES = {
  alimentation: { label: "Alimentation",             color: "#f57c00", emoji: "🛒" },
  sante:        { label: "Santé",                    color: "#c62828", emoji: "🏥" },
  parcs:        { label: "Parcs / espaces verts",    color: "#2e7d32", emoji: "🌳" },
  loisirs:      { label: "Loisirs et socialisation", color: "#6a1b9a", emoji: "🎭" },
  services:     { label: "Services complémentaires", color: "#455a64", emoji: "🔧" },
  transport:    { label: "Transport en commun",      color: "#1565c0", emoji: "🚌" }
};

// Seuil de canopée pour obtenir 1 point de score
const SEUIL_CANOPEE = 30;


// --- Variables d'état ---
// Ces variables gardent en mémoire l'état courant de l'application
let donneesZones    = null; // zones de desserte chargées au démarrage
let coucheResidence = null; // couche Leaflet des résidences
let coucheZoneActive = null; // zone colorée actuellement affichée
let donneesServices = {};   // équipements par catégorie


// ================================================
// CARTE DE BASE
// ================================================

// Crée la carte Leaflet centrée sur les Laurentides
const carte = L.map("map").setView([46.1, -74.4], 8);

// Ajoute le fond de carte OpenStreetMap
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(carte);

// Groupe qui contiendra les équipements affichés au clic
const coucheEquipements = L.layerGroup().addTo(carte);


// ================================================
// STYLES DES COUCHES
// ================================================

// Contour de la MRC (fond vert pâle)
function styleMRC() {
  return { color: "#1a1a1a", weight: 2.8, fillColor: "#d9ead3", fillOpacity: 0.18 };
}

// Résidences (cercles bleus)
function styleResidence() {
  return { radius: 8, fillColor: "#1565c0", color: "#1a1a1a", weight: 1.5, opacity: 1, fillOpacity: 0.95 };
}

// Zone de desserte colorée selon le score
function styleZone(score) {
  const couleur = couleurParScore(score);
  return { color: couleur, weight: 3, fillColor: couleur, fillOpacity: 0.28 };
}

// Équipements affichés comme points
function stylePointEquipement(cat) {
  return { radius: 5, fillColor: CATEGORIES[cat].color, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.9 };
}

// Équipements affichés comme polygones
function stylePolygoneEquipement(cat) {
  return { color: CATEGORIES[cat].color, weight: 1.5, fillColor: CATEGORIES[cat].color, fillOpacity: 0.25 };
}

// Retourne une couleur selon le score (vert, jaune ou rouge)
function couleurParScore(score) {
  if (score >= 6) return "#2e7d32";
  if (score >= 3) return "#f9a825";
  return "#c62828";
}


// ================================================
// FONCTIONS UTILITAIRES
// ================================================

// Lit un champ dans les propriétés GeoJSON en essayant plusieurs noms possibles
// (les fichiers n'utilisent pas toujours les mêmes noms de colonnes)
function lireChamp(props, noms) {
  if (!props) return null;
  for (const nom of noms) {
    const val = props[nom];
    if (val !== undefined && val !== null && val !== "") return val;
  }
  // Deuxième essai sans tenir compte des majuscules
  const cles = Object.keys(props);
  for (const nom of noms) {
    const cle = cles.find(c => c.toLowerCase() === nom.toLowerCase());
    if (cle && props[cle] !== undefined && props[cle] !== null && props[cle] !== "") return props[cle];
  }
  return null;
}

// Met la première lettre en minuscule
function minusculeDebut(texte) {
  if (!texte || texte === "Donnée non disponible") return texte;
  return texte.charAt(0).toLowerCase() + texte.slice(1);
}

// Retourne le nom d'une résidence
function nomResidence(props) {
  return lireChamp(props, ["Nom_Résid", "Nom_Resid", "nom_residence", "name"]) || "Résidence sans nom";
}

// Retourne le nom d'un équipement
function nomEquipement(props) {
  return lireChamp(props, ["name", "NOM", "Nom", "nom", "fclass"]) || "Service";
}

// Regroupe les infos d'une résidence dans un objet facile à utiliser
function infoResidence(props) {
  return {
    nom:          nomResidence(props),
    adresse:      lireChamp(props, ["Adresse_RP", "adresse"])     || "Adresse non disponible",
    municipalite: lireChamp(props, ["Municipali", "municipalite"]) || "Municipalité non disponible",
    codePostal:   lireChamp(props, ["Code_posta", "code_postal"])  || ""
  };
}


// ================================================
// INDICE DE DÉFAVORISATION (IDMS)
// ================================================

// Valide et normalise un code ComRSS (ex: "c1" → "C1")
function nettoyerCode(valeur) {
  if (!valeur) return null;
  const code = String(valeur).trim().toUpperCase();
  return ["C1", "C2", "C3", "C4", "C5"].includes(code) ? code : null;
}

// Texte d'interprétation selon la classe ComRSS
function texteComRSS(code) {
  const textes = {
    C1: "Matériellement et socialement très favorisées",
    C2: "Moyennes",
    C3: "Socialement très défavorisées",
    C4: "Matériellement très défavorisées",
    C5: "Matériellement et socialement très défavorisées"
  };
  return textes[code] || "Donnée non disponible";
}

// Regroupe toutes les données IDMS d'une zone
function infoIDMS(props) {
  const comrss = lireChamp(props, ["ComRSS", "COMRSS", "comrss", "Com_RSS", "COM_RSS"]);
  const interp = lireChamp(props, ["INTERP_IDMS", "Interp_IDMS", "interp_idms", "DEFAV_COMB", "defav_comb"]);
  const code   = nettoyerCode(comrss);
  return {
    materielle:     lireChamp(props, ["QuintMatRS", "QUINTMATRS", "quintmatrs"]),
    sociale:        lireChamp(props, ["QuintSocRS", "QUINTSOCRS", "quintsocrs"]),
    comrss:         code,
    interpretation: (interp && String(interp).trim() !== "") ? String(interp).trim() : texteComRSS(code)
  };
}

// Retourne la classe CSS selon la sévérité de la défavorisation
function classeIDMS(comrss) {
  const code = nettoyerCode(comrss);
  if (!code)         return { css: "idms-neutre", texte: "Donnée non disponible" };
  if (code === "C1") return { css: "idms-faible", texte: texteComRSS(code) };
  if (code === "C2") return { css: "idms-moyen",  texte: texteComRSS(code) };
  return               { css: "idms-forte",  texte: texteComRSS(code) };
}


// ================================================
// CANOPÉE ET TEMPÉRATURE
// ================================================

// Lit le pourcentage de canopée de la zone
function pctCanopee(zone) {
  if (!zone?.properties) return null;
  const p = zone.properties;
  const cle = Object.keys(p).find(k => k.toUpperCase().includes("PCT") && k.toUpperCase().includes("CANO"));
  const val = cle ? p[cle] : (p["PCT_CANOPE"] ?? p["PCT_CANOP"] ?? p["pct_canopee"] ?? null);
  if (val === null || val === undefined || val === "") return null;
  const n = Number(String(val).replace(",", "."));
  return isNaN(n) ? null : n;
}

// Lit la température moyenne de la zone
function tempMoyenne(zone) {
  if (!zone?.properties) return null;
  const p = zone.properties;
  const val = p["MEAN"] ?? p["Temp_Moy"] ?? p["TEMP_MOY"] ?? null;
  if (val === null || val === undefined) return null;
  const n = Number(String(val).replace(",", "."));
  return isNaN(n) ? null : n;
}

// Lit la classe de température (ex: "Frais", "Chaud")
function classeTemp(zone) {
  if (!zone?.properties) return null;
  const p = zone.properties;
  return p["Classe_Temp"] || p["CLASSE_TEMP"] || p["classe_temp"] || null;
}

// Retourne 1 point si la température est favorable, sinon 0
function pointTemp(zone) {
  const classe = classeTemp(zone);
  if (!classe) return 0;
  const t = String(classe).toLowerCase();
  return (t.includes("frais") || t.includes("modéré") || t.includes("modere")) ? 1 : 0;
}


// ================================================
// CALCUL DU SCORE (sur 8)
// 1 pt par catégorie présente (max 6) + canopée + température
// ================================================

function calculerScore(stats, zone) {
  let score = Object.values(stats).filter(n => n > 0).length; // 1 pt par catégorie présente
  const canopee = pctCanopee(zone);
  if (canopee !== null && canopee >= SEUIL_CANOPEE) score += 1; // bonus canopée
  score += pointTemp(zone);                                      // bonus température
  return score;
}

// Retourne la classe CSS et le texte selon le score
function classeScore(score) {
  if (score >= 6) return { css: "favorable", texte: "Milieu de vie favorable" };
  if (score >= 3) return { css: "moyen",     texte: "Milieu de vie moyennement favorable" };
  return               { css: "faible",    texte: "Milieu de vie peu favorable" };
}


// ================================================
// ANALYSE SPATIALE (via Turf.js)
// ================================================

// Vérifie si un équipement est dans la zone sélectionnée
function dansZone(feature, zone) {
  try { return turf.booleanIntersects(feature, zone); }
  catch (e) { console.warn("Erreur intersection :", e); return false; }
}

// Trouve la zone de desserte qui contient la résidence cliquée
function trouverZone(residence) {
  if (!donneesZones) return null;
  const point = turf.point(residence.geometry.coordinates);
  return donneesZones.features.find(z => turf.booleanPointInPolygon(point, z)) || null;
}

// Filtre et affiche les équipements dans la zone, retourne les comptages
function analyserEquipements(zone) {
  coucheEquipements.clearLayers(); // efface les équipements précédents
  const stats = {};

  Object.keys(CATEGORIES).forEach(cat => {
    const data = donneesServices[cat];
    if (!data?.features) { stats[cat] = 0; return; }

    const presents = data.features.filter(f => dansZone(f, zone)); // filtre dans la zone
    stats[cat] = presents.length;

    // Affiche sur la carte
    const couche = L.geoJSON(presents, {
      pointToLayer: (f, latlng) => L.circleMarker(latlng, stylePointEquipement(cat)),
      style: () => stylePolygoneEquipement(cat),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<strong>${nomEquipement(f.properties)}</strong><br>${CATEGORIES[cat].label}`);
      }
    });
    coucheEquipements.addLayer(couche);
  });

  return stats;
}


// ================================================
// AFFICHAGE SUR LA CARTE
// ================================================

// Affiche le contour de la MRC
function afficherMRC(data) {
  const couche = L.geoJSON(data, { style: styleMRC, interactive: false }).addTo(carte);
  carte.fitBounds(couche.getBounds());
}

// Affiche toutes les résidences avec leur événement de clic
function afficherResidences(data) {
  coucheResidence = L.geoJSON(data, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, styleResidence()),
    onEachFeature: (f, layer) => {
      layer.bindTooltip(nomResidence(f.properties), { direction: "top", offset: [0, -8] });
      layer.on("click", () => selectionnerResidence(f)); // clic → sélection
    }
  }).addTo(carte);
  coucheResidence.bringToFront();
}

// Affiche la zone colorée (remplace la précédente)
function afficherZone(zone, score) {
  if (coucheZoneActive) carte.removeLayer(coucheZoneActive);
  coucheZoneActive = L.geoJSON(zone, { style: styleZone(score) }).addTo(carte);
  coucheZoneActive.bringToFront();
  if (coucheResidence) coucheResidence.bringToFront();
  carte.fitBounds(coucheZoneActive.getBounds(), { padding: [40, 40] });
}


// ================================================
// GÉNÉRATION DU PANNEAU LATÉRAL
// ================================================

// En-tête toujours visible
function htmlEntete() {
  return `
    <div class="entete">
      <div class="entete-sous-titre">Analyse territoriale — Laurentides</div>
      <div class="entete-titre">Évaluation de l'environnement bâti autour des résidences pour personnes âgées</div>
      <div class="entete-texte">Cette application permet d'évaluer l'environnement bâti autour des résidences pour personnes âgées dans la région des Laurentides.</div>
      <div class="entete-badge">Zone desserte 750 m • Score de l'environnement  • Défavorisation matérielle et sociale</div>
    </div>`;
}

// Bloc score
function htmlScore(score) {
  const c = classeScore(score);
  return `
    <div class="score-carte ${c.css}">
      <div class="score-note">${score} / 8</div>
      <div class="score-texte">${c.texte}</div>
    </div>`;
}

// Tableau des équipements + canopée + température
function htmlEquipements(stats, zone) {
  const canopee  = pctCanopee(zone);
  const tMoy     = tempMoyenne(zone);
  const tClasse  = classeTemp(zone);
  const ptCano   = (canopee !== null && canopee >= SEUIL_CANOPEE) ? 1 : 0;
  const ptTemp   = pointTemp(zone);

  // Une ligne par catégorie : emoji + nom | nombre
  const lignes = Object.keys(CATEGORIES).map(cat => `
    <div class="equipement-ligne">
      <span class="equipement-nom">${CATEGORIES[cat].emoji} ${CATEGORIES[cat].label}</span>
      <span class="equipement-valeur">${stats[cat]}</span>
    </div>`).join("");

  // Canopée : valeur + points
  const texteCano = canopee !== null ? canopee.toFixed(1) + " %  " + ptCano + "/1" : "N/D";

  // Température : classe + valeur + points
  const texteTemp = tClasse ? tClasse + (tMoy !== null ? " — " + tMoy.toFixed(1) + " °C" : "") + "  " + ptTemp + "/1" : "N/D";

  return `
    <div class="equipements">
      <div class="section-titre">Équipements, canopée et température</div>
      ${lignes}
      <div class="equipement-ligne">
        <span class="equipement-nom">🌿 Canopée</span>
        <span class="equipement-valeur">${texteCano}</span>
      </div>
      <div class="equipement-ligne">
        <span class="equipement-nom">🌡️ Température de surface</span>
        <span class="equipement-valeur">${texteTemp}</span>
      </div>
    </div>`;
}

// Bloc IDMS
function htmlIDMS(props) {
  const idms  = infoIDMS(props);
  const cl    = classeIDMS(idms.comrss);
  const code  = idms.comrss || "N/D";

  return `
    <div class="idms-carte ${cl.css}">
      <div class="idms-titre">Indice de défavorisation matérielle et sociale</div>
      <div class="idms-code">${code}</div>
      <div class="idms-texte">${idms.interpretation}</div>
      <div class="equipements">
        <div class="equipement-ligne">
          <span class="equipement-nom">Défavorisation matérielle</span>
          <span class="equipement-valeur">${idms.materielle !== null ? idms.materielle + " / 5" : "N/D"}</span>
        </div>
        <div class="equipement-ligne">
          <span class="equipement-nom">Défavorisation sociale</span>
          <span class="equipement-valeur">${idms.sociale !== null ? idms.sociale + " / 5" : "N/D"}</span>
        </div>
        <div class="equipement-ligne">
          <span class="equipement-nom">Classe combinée</span>
          <span class="equipement-valeur">${code}</span>
        </div>
      </div>
    </div>`;
}

// Bloc interprétation en langage naturel
function htmlInterpretation(props, stats, zone) {
  const score     = calculerScore(stats, zone);
  const sc        = classeScore(score);
  const idms      = infoIDMS(props);
  const res       = infoResidence(props);
  const canopee   = pctCanopee(zone);
  const tClasse   = classeTemp(zone);
  const tMoy      = tempMoyenne(zone);

  // Liste des problèmes détectés
  const problemes = [];

  const absentes = Object.keys(CATEGORIES).filter(cat => stats[cat] === 0);
  if (absentes.length > 0) {
    problemes.push(`les équipements absents sont : <strong>${absentes.map(c => CATEGORIES[c].label).join(", ")}</strong>`);
  }
  if (canopee !== null && canopee < SEUIL_CANOPEE) {
    problemes.push(`la canopée est inférieure au seuil de ${SEUIL_CANOPEE} %, avec <strong>${canopee.toFixed(1)} %</strong>`);
  } else if (canopee === null) {
    problemes.push("la donnée sur la canopée n'est pas disponible");
  }
  if (tClasse) {
    if (String(tClasse).toLowerCase().includes("chaud")) {
      problemes.push(`la température est classée <strong>chaude</strong>${tMoy !== null ? `, avec une moyenne de <strong>${tMoy.toFixed(1)} °C</strong>` : ""}`);
    }
  } else {
    problemes.push("la donnée sur la température de surface n'est pas disponible");
  }

  const texteEquip = problemes.length > 0
    ? problemes.join("; ") + "."
    : "l'ensemble des équipements, la canopée et la température de surface atteignent les seuils retenus.";

  const texteIDMS = idms.comrss
    ? `Elle se trouve dans la municipalité de <strong>${res.municipalite}</strong>, dans un secteur de classe <strong>${idms.comrss}</strong> : <strong>${minusculeDebut(idms.interpretation)}</strong>.`
    : `Elle se trouve dans la municipalité de <strong>${res.municipalite}</strong>, mais l'information sur la défavorisation n'est pas disponible.`;

  return `
    <div class="interpretation ${sc.css}">
      <div class="interpretation-titre">Interprétation finale</div>
      <p>Cette résidence présente un score de <strong>${score} / 8</strong>, ce qui correspond à un <strong>${sc.texte.toLowerCase()}</strong>. Selon les données analysées, ${texteEquip}</p>
      <p>${texteIDMS}</p>
    </div>`;
}

// Légende des catégories d'équipements
function htmlLegendeEquipements() {
  return Object.keys(CATEGORIES).map(cat => `
    <div class="ligne-legende">
      <span class="icone-cercle" style="background:${CATEGORIES[cat].color};"></span>
      <span>${CATEGORIES[cat].label}</span>
    </div>`).join("");
}

// Panneau d'accueil avec la légende complète
function afficherAccueil() {
  document.getElementById("info").innerHTML = `
    ${htmlEntete()}
    <div class="boite-instruction">
      <strong>Cliquez sur une résidence</strong> pour afficher son score,
      son indice de défavorisation, les équipements accessibles et l'interprétation finale.
    </div>
    <hr class="separateur">
    <div class="bloc-legende">
      <div class="bloc-legende-titre">Classification du milieu de vie</div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#e8f5e9;border-color:#2e7d32;"></span><span>Favorable : 6 à 8 / 8</span></div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#fff8e1;border-color:#f9a825;"></span><span>Moyennement favorable : 3 à 5 / 8</span></div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#ffebee;border-color:#c62828;"></span><span>Peu favorable : 0 à 2 / 8</span></div>
    </div>
    <div class="bloc-legende">
      <div class="bloc-legende-titre">Équipements</div>
      ${htmlLegendeEquipements()}
    </div>
    <div class="bloc-legende">
      <div class="bloc-legende-titre">Canopée et température</div>
      <div class="ligne-legende"><span class="icone-trait" style="background:#2e7d32;"></span><span>Canopée favorable : ${SEUIL_CANOPEE} % et plus</span></div>
      <div class="ligne-legende"><span class="icone-trait" style="background:#2e7d32;"></span><span>Température favorable : frais ou modéré</span></div>
      <div class="ligne-legende"><span class="icone-trait" style="background:#c62828;"></span><span>Température défavorable : chaud</span></div>
    </div>
    <div class="bloc-legende">
      <div class="bloc-legende-titre">Défavorisation combinée</div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#e8f5e9;border-color:#2e7d32;"></span><span>C1 : matériellement et socialement très favorisées</span></div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#fff8e1;border-color:#f9a825;"></span><span>C2 : moyennes</span></div>
      <div class="ligne-legende"><span class="icone-carre" style="background:#ffebee;border-color:#c62828;"></span><span>C3 à C5 : défavorisation forte selon la dimension</span></div>
    </div>`;
}

// Panneau d'une résidence sélectionnée
function afficherPanneau(props, stats = null, zone = null) {
  const res = infoResidence(props);

  const contenu = (stats && zone)
    ? htmlScore(calculerScore(stats, zone))
      + htmlEquipements(stats, zone)
      + htmlIDMS(props)
      + htmlInterpretation(props, stats, zone)
    : `<div class="info-ligne">Les données seront affichées après le chargement complet des fichiers.</div>`
      + htmlIDMS(props);

  document.getElementById("info").innerHTML = `
    ${htmlEntete()}
    <div class="residence-titre">${res.nom}</div>
    <div class="info-ligne"><span class="info-etiquette">Adresse :</span> ${res.adresse}</div>
    <div class="info-ligne"><span class="info-etiquette">Municipalité :</span> ${res.municipalite}</div>
    <div class="info-ligne"><span class="info-etiquette">Code postal :</span> ${res.codePostal}</div>
    <hr style="margin:10px 0;border:none;border-top:1px solid #ddd;">
    <div class="info-ligne"><span class="info-etiquette">Zone analysée :</span> Zone desserte 750 m</div>
    ${contenu}`;
}

// Message d'erreur dans le panneau
function afficherErreur(message) {
  document.getElementById("info").innerHTML = `${htmlEntete()}<div class="boite-instruction">${message}</div>`;
}


// ================================================
// SÉLECTION D'UNE RÉSIDENCE (déclenché au clic)
// ================================================

// Vérifie que toutes les données sont bien chargées
function donneesPretes() {
  return donneesZones && Object.keys(CATEGORIES).every(cat => donneesServices[cat]?.features);
}

// Au clic sur une résidence : trouve la zone, analyse, affiche
function selectionnerResidence(residence) {
  if (!donneesPretes()) {
    afficherPanneau(residence.properties); // données pas encore prêtes
    return;
  }

  const zone = trouverZone(residence);

  if (!zone) {
    // Aucune zone trouvée : on affiche quand même les infos de base
    coucheEquipements.clearLayers();
    if (coucheZoneActive) { carte.removeLayer(coucheZoneActive); coucheZoneActive = null; }
    afficherPanneau(residence.properties);
    return;
  }

  const stats = analyserEquipements(zone);
  const score = calculerScore(stats, zone);

  afficherZone(zone, score);
  afficherPanneau(residence.properties, stats, zone);

  // Remet les résidences au premier plan
  coucheEquipements.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
  if (coucheResidence) coucheResidence.bringToFront();
}


// ================================================
// DÉMARRAGE — charge les données et lance la carte
// ================================================

// Charge un fichier GeoJSON
function chargerJSON(url) {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error(`Fichier introuvable : ${url}`);
    return res.json();
  });
}

// Charge tous les fichiers en même temps, puis initialise la carte
async function demarrer() {
  afficherAccueil();

  try {
    const cats = Object.keys(CATEGORIES);

    // Chargement simultané de tous les fichiers
    const resultats = await Promise.all([
      chargerJSON(FICHIERS.zones),
      chargerJSON(FICHIERS.mrc),
      chargerJSON(FICHIERS.residences),
      ...cats.map(cat => chargerJSON(FICHIERS[cat]))
    ]);

    donneesZones = resultats[0];
    afficherMRC(resultats[1]);
    afficherResidences(resultats[2]);
    cats.forEach((cat, i) => { donneesServices[cat] = resultats[i + 3]; });

    afficherAccueil(); // rafraîchit le panneau une fois tout chargé

  } catch (erreur) {
    console.error("Erreur :", erreur);
    afficherErreur("Impossible de charger toutes les données. Vérifiez les noms des fichiers dans le dossier <code>data/</code>.");
  }
}

// Lance l'application
demarrer();