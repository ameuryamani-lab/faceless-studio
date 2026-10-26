# Changer de concept

Un concept = un dossier `concept/<nom>/` : `concept.json` (héros, voix, format), `rules.md` (ton, règles, exemples), `cast.json` (le casting) et les planches dans `cast/<héros>/`. Le fichier `concept/active.json` dit lequel est en cours. Aucune émission n'est livrée avec le studio : seulement le modèle vierge `concept/_modele/`. Au premier lancement, Claude Code vous demande ce que vous voulez faire (héros, apparence, format d'accroche, durée, langue, voix, style de dessin, palette, casting) et remplit le modèle avec vos réponses.

Pour passer à un nouveau concept :
1. Copier le modèle vierge `concept/_modele/` en `concept/<nouveau>/` (ou un de vos concepts existants).
2. Remplacer chaque `<…>` de `concept.json` (héros, voix, format), `rules.md` (ton, règles) et `cast.json` (casting) ; déposer les planches du héros dans `cast/<héros>/` : au moins `closeup-front.png`, `waist-front.png` et `full-front.png`.
3. Taper `node --no-warnings core/concept.mjs check <nouveau>` : il dit en français ce qui manque.
4. Faire une répétition : `node --no-warnings workshop/story/chain.mjs --repetition --concept <nouveau>` (jamais publiée) et regarder `media/r-…/final.mp4`.
5. Dire « Lester, passe au concept <nouveau> » (ou `node --no-warnings core/concept.mjs activate <nouveau>`) : la prochaine vidéo le prend, les anciennes gardent leur concept.

Un dossier incomplet est refusé et le studio continue avec l'ancien concept. Modifier `active.json` à la main marche aussi, mais sans les vérifications : déconseillé.
Les règles de la société (français pour le propriétaire, rien de payant, un ordre suffit, interdits) sont dans `brand/studio.md` et ne changent jamais avec le concept.

Les planches du héros se fabriquent avec ComfyUI : `node --no-warnings concept/make-cast.mjs poses|members|layouts|contact [concept]` écrit des candidates dans `cast/<membre>/_candidats/` ; choisissez-en une et copiez-la sous son vrai nom (`closeup-front.png`, …).
