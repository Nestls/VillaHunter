# VillaHunter

VillaHunter est un tableau de chasse pour locations de vacances. Il centralise les liens Airbnb, Booking, Abritel, Vrbo et autres plateformes, réinjecte les dates exactes dans les liens Airbnb et permet de noter manuellement la disponibilité, le prix et les points importants.

## MVP 0.1

- dates d’arrivée et de départ strictes ;
- composition du groupe et budget total ;
- import de plusieurs liens à la fois ;
- nettoyage et déduplication des URL ;
- réécriture des critères Airbnb avec `checkin`, `checkout`, adultes, enfants et bébés ;
- classement : à vérifier, disponible, indisponible, hors budget ou favori ;
- sauvegarde locale automatique dans le navigateur ;
- export JSON du projet ;
- interface responsive utilisable sur ordinateur et téléphone ;
- tests unitaires et déploiement GitHub Pages.

## Utilisation sans installation

Après fusion de la pull request, active GitHub Pages avec **GitHub Actions** comme source dans les réglages du dépôt. Le workflow publiera automatiquement le site depuis `main`.

Pour tester dans un Codespace :

```bash
npm test
npm run serve
```

Puis ouvre le port `8000` proposé par Codespaces.

## Limites assumées

VillaHunter ne contourne pas les connexions, CAPTCHA, protections anti-bot ou conditions d’utilisation des plateformes. Le MVP ouvre les recherches avec les bons critères et organise la vérification humaine. Une version ultérieure pourra recevoir des connecteurs officiels ou une extension navigateur locale lorsque cela est autorisé.

## Suite proposée

1. import et réouverture d’un projet JSON ;
2. partage familial d’une sélection ;
3. score automatique selon budget, piscine, distance et capacité ;
4. capture assistée du prix et de la disponibilité depuis une page ouverte ;
5. historique des contrôles et alertes de changement.
