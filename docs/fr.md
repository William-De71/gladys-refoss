# Refoss

## Présentation

Cette intégration amène vos appareils Refoss dans Gladys, sur votre réseau local, sans le cloud Refoss : la prise connectée P11S, les relais et modules de volet R10, R11 et R21, et les compteurs d’énergie EM01P, EM06, EM06P, EM16 et EM16P avec leurs pinces ampèremétriques.

Chaque prise, volet et pince devient un appareil Gladys que vous pouvez piloter, ranger dans une pièce, utiliser dans des scènes et ajouter au suivi de l’énergie de Gladys : l’intégration transforme les compteurs des appareils, qui repartent de zéro chaque mois, en index d’énergie qui ne font que monter.

Sans lien avec Refoss.

![Le widget « Appareil Refoss » d’une pince sur la pompe à chaleur à côté de la vue d’ensemble « Puissance Refoss » (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-refoss/main/docs/assets/widgets.fr.png)

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Vos appareils Refoss installés avec l’application Refoss et connectés au même réseau que Gladys.
- Pour les premiers modèles (R10, EM06, EM16) : une adresse IP fixe, réservée dans votre box (bail DHCP statique).
- Si vous avez protégé vos appareils par un mot de passe dans l’application Refoss : ce mot de passe.

## Configuration

### Appareils

Les modèles actuels (P11S, R11, R21, EM01P, EM06P, EM16P) sont trouvés tout seuls : acceptez la découverte réseau à l’installation de l’intégration, puis appuyez sur **Rechercher les appareils**.

Gladys ne peut pas trouver les premiers modèles (R10, EM06, EM16) : saisissez leurs adresses IP dans **Adresses des anciens modèles**, séparées par des virgules. Vous pouvez aussi y saisir l’adresse d’un modèle actuel placé sur un autre sous-réseau.

**Mot de passe des appareils** : seulement si vous en avez défini un dans l’application Refoss (le même pour tous vos appareils). Sinon, laissez vide.

### Rafraîchissement et langue

**Rafraîchissement des mesures** : à quelle fréquence la puissance, la tension, l’intensité et l’énergie sont envoyées à Gladys (10, 30 ou 60 secondes) ; marche / arrêt et volets partent toujours tout de suite. **Nouvelle recherche** : à quelle fréquence le réseau est fouillé à la recherche de nouveaux appareils. **Langue des noms d’appareils** : la langue des noms de fonctionnalités et des messages d’erreur des scènes.

## Utilisation

### Appareils

Ouvrez l’onglet **Découverte** de l’intégration et ajoutez les appareils voulus. Il y a un appareil Gladys par canal :

- une **prise ou un relais** : marche / arrêt, et puissance, tension, intensité et un index d’énergie quand l’appareil les mesure ;
- un **volet** (R11 ou R21 en mode volet) : ouvrir, arrêter, fermer, et la position une fois le moteur calibré dans l’application Refoss ;
- une **pince** d’un compteur d’énergie : puissance (négative quand la ligne renvoie de l’énergie, une ligne solaire par exemple), tension, intensité, énergie consommée et énergie renvoyée.

Les noms viennent de l’application Refoss ; une pince sans nom prend le nom de son boîtier et sa position (`A1`, `B1`…).

### Suivi de l’énergie

La fonctionnalité **Énergie consommée** d’une prise ou d’une pince est un index en kWh qui ne fait que monter : ajoutez l’appareil au suivi de l’énergie de Gladys pour voir sa consommation quotidienne et son coût. La fonctionnalité **Énergie renvoyée** d’une pince suit ce qu’elle a renvoyé. L’index démarre le jour où vous ajoutez l’appareil.

### Widgets

- **Puissance Refoss** : chaque prise, pince et volet d’un coup d’œil, le plus gourmand en premier, avec son énergie du mois, et les appareils qui ne répondent pas.
- **Appareil Refoss** : une prise, une pince ou un volet avec sa puissance en direct, aujourd’hui, ce mois-ci, sa courbe de puissance des dernières 24 heures et ses boutons.

### Scènes

Déclencheurs : **Un bouton d’un appareil Refoss est appuyé** (appui simple, double, triple ou long sur l’entrée d’un R11, R21 ou P11S), **Une protection Refoss se déclenche** (surpuissance, surtension, surintensité, sous-tension, surchauffe), **Un appareil Refoss est perdu**, **Un appareil Refoss est de retour**.

Actions : **Allumer une prise Refoss un moment** (éteinte après la durée, même après un redémarrage), **Lire l’énergie d’un appareil Refoss** (puissance, aujourd’hui, cette semaine, ce mois, renvoyé, index).

Exemples :

- Double appui sur le bouton de l’entrée → éteindre toutes les lumières.
- Une protection se déclenche sur la prise du four → envoyer une notification.
- Chaque soir → lire l’énergie de la pompe à chaleur et l’envoyer dans un message.

## Dépannage

- **Un appareil n’est pas trouvé** : vérifiez que l’application Refoss le joint sur le même Wi-Fi que Gladys et que votre réseau laisse passer le mDNS, ou saisissez son adresse. Un R10, un EM06 ou un EM16 a toujours besoin de son adresse.
- **« protégé par un mot de passe »** : saisissez le mot de passe de l’application Refoss dans la configuration.
- **Une pince compte la consommation comme de l’énergie renvoyée** : retournez la pince (la flèche dessus indique le sens).
- **« Gladys a refusé la recherche réseau »** : réinstallez l’intégration en acceptant sa découverte réseau.
- Le bouton **Rechercher les appareils** liste ce que voit l’intégration ; l’onglet Logs de l’intégration en dit plus.

Signalez un problème sur [GitHub](https://github.com/William-De71/gladys-refoss/issues) avec votre version de Gladys, la version de l’intégration, le modèle de l’appareil et les logs.
