# VillaHunter

VillaHunter est un moteur de recherche multi-sources pour locations de vacances. L’utilisateur décrit le séjour une seule fois : lieu, temps de trajet maximal, dates exactes ou flexibles, voyageurs, animaux, budget, équipements et critères difficiles comme l’absence de voisins proches.

## Version 0.2

### Formulaire complet

- lieu de référence et temps de trajet maximal ;
- dates exactes ou période flexible avec durée de séjour ;
- adultes, enfants, bébés et animaux séparés ;
- chambres, lits et salles de bain minimum ;
- budget total minimum et maximum ;
- types de logement ;
- liste d’équipements : piscine privée ou chauffée, jacuzzi, barbecue, climatisation, jardin clôturé, matériel bébé, recharge électrique, accessibilité, etc. ;
- critères spéciaux : calme, peu de voisins, maison isolée, aucun espace partagé, sécurité enfants, route peu passante, logement entier ;
- précisions libres ;
- sélection des sources.

### Recherche automatique

Le serveur `/api/search` :

1. géocode le lieu ;
2. découvre les agences, offices de tourisme et hébergements publics dans la zone ;
3. calcule le temps de trajet routier lorsque les coordonnées sont disponibles ;
4. analyse un nombre limité de pages publiques par site ;
5. extrait prudemment équipements, capacité, prix et signaux de disponibilité ;
6. prépare aussi les recherches Airbnb, Booking et Abritel/Vrbo avec les bons voyageurs et les bonnes dates ;
7. attribue un score et explique les points positifs et incertains.

VillaHunter ne contourne aucune connexion, CAPTCHA, protection anti-robot ou restriction d’accès. Une disponibilité détectée doit être confirmée sur le site de réservation avant paiement.

## Hébergement

### Interface seule sur GitHub Pages

L’interface statique reste disponible sur GitHub Pages. Elle peut afficher les critères et résultats sauvegardés, mais GitHub Pages ne peut pas exécuter le serveur `/api/search`.

### Application complète sur Vercel

Le dépôt est prêt pour un import Vercel sans adaptation :

1. importer `Nestls/VillaHunter` dans Vercel ;
2. conserver les réglages automatiques ;
3. déployer ;
4. ouvrir l’adresse Vercel obtenue.

L’interface et l’API seront alors hébergées ensemble. Depuis la version GitHub Pages, il est aussi possible d’ouvrir **Configurer l’API** et de coller l’adresse Vercel.

### Recherche web étendue facultative

Sans clé, VillaHunter utilise les données publiques OpenStreetMap, les sites directs découverts et les recherches préparées pour les grandes plateformes. Pour élargir la découverte aux agences moins bien référencées, ajouter dans Vercel la variable d’environnement :

```text
BRAVE_SEARCH_API_KEY=...
```

La recherche continue de fonctionner sans cette variable, avec une couverture plus limitée.

## Développement

```bash
npm test
npm run check
npm run serve
```

Pour tester les fonctions serveur localement avec Vercel CLI :

```bash
npm install -g vercel
vercel dev
```

## Architecture

- `index.html` : formulaire et résultats ;
- `src/app.js` : état, recherche, favoris et rendu ;
- `src/search-model.js` : validation, dates flexibles, équipements et score ;
- `src/core.js` : normalisation des liens existants ;
- `api/search.js` : orchestration, géocodage, découverte, routage et analyse des pages ;
- `api/health.js` : état du moteur ;
- `test/` : tests unitaires ;
- `.github/workflows/ci.yml` : tests, vérifications syntaxiques et GitHub Pages.

## Limites connues

- Les grandes plateformes peuvent empêcher la lecture automatisée de leurs pages. VillaHunter prépare alors un lien filtré à ouvrir.
- Les agences locales n’exposent pas toutes leur inventaire ou leur disponibilité dans le HTML public.
- Le temps de trajet dépend du service de routage disponible et peut être approximé en cas d’échec.
- Les informations extraites sont accompagnées d’un niveau de confiance et ne remplacent pas la confirmation finale auprès du loueur.
