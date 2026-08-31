<div align="center">

# Deckuse

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PPTX](https://img.shields.io/badge/Format-PPTX-B7472A?logo=microsoftpowerpoint&logoColor=white)](#pptx-capabilities)

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

</div>

Deckuse est un moteur local-first et piloté par schéma pour automatiser les documents Office avec des agents de code. Il ouvre un document dans un espace de travail versionné, permet à un agent d’inspecter et de cibler sa structure, applique des commandes JSON explicites, valide le résultat, puis exporte un nouveau document.

PPTX est le seul format actuellement implémenté. Les adaptateurs DOCX, XLSX, Keynote et Numbers renvoient volontairement `FORMAT_NOT_IMPLEMENTED` : ils ne sont pas encore des cibles d’édition prises en charge.

## Pourquoi Deckuse

Deckuse permet de modifier une présentation existante sans la recréer. Son flux de travail privilégie volontairement la structure plutôt que le rendu visuel :

```text
existing.pptx → init → inspect / query → apply JSON commands → validate → package.pptx
```

Chaque écriture réussie commit automatiquement une révision Git, met à jour `operations.jsonl` et reconstruit `package.pptx`. Utilisez `undo` pour annuler des écritures et `history` pour consulter le journal des opérations.

Il préserve autant que possible le XML intact et les parties inconnues du package. Ce n’est pas un moteur de rendu : il ne peut pas juger de manière fiable l’esthétique ou la mise en page d’une diapositive.

## Installation

Prérequis : Node.js 18 ou ultérieur.

```sh
npm install -g @deckflow/deckuse
```

Cette commande installe globalement le CLI `deckuse`.

```sh
# Créer un espace de travail persistant depuis une présentation.
deckuse init input.pptx ./workspace --json

# Inspecter le document indexé et interroger les éléments ciblés.
deckuse inspect ./workspace --json
deckuse query ./workspace 'kind=textbox text=Quarter' --json
deckuse query ./workspace '*' --limit 500 --json

# Appliquer une commande JSON, un tableau JSON ou du JSONL.
deckuse apply ./workspace --input operations.jsonl --json

# Valider l'espace de travail, consulter l'historique et annuler des écritures.
deckuse validate ./workspace --json
deckuse history ./workspace --json
deckuse undo ./workspace --steps 1 --json
```

## Flux de travail CLI

`apply` accepts a single JSON object, a JSON array, or JSON Lines. Use `--input -` (the default) to read from standard input. Commands passed to `apply` do not need `version`, `workspaceId`, or `transactionId`: the CLI supplies them and reads the current workspace revision before each command.

Les résultats sont écrits en JSON sur la sortie standard ; les erreurs d’arguments ou d’entrée sont écrites sur la sortie d’erreur. Le code `0` indique la réussite, `1` l’échec d’une commande et `2` une erreur d’usage ou d’analyse CLI.

### Sélecteurs

`query` accepts either a selector string or a structured selector in a command. Space-separated terms are combined with AND.

| Syntax                                 | Meaning                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `*` or `all`                           | Match every indexed element.                         |
| `kind=textbox`                         | Match an element kind by case-insensitive substring. |
| `text=Quarter`                         | Match text that contains the literal value.          |
| `text~=pattern`                        | Match text with a Unicode regular expression.        |
| `hasText=true`                         | Match elements that contain text.                    |
| `slide=256`, `id=256:10`, `name=Title` | Filter by slide ID, element ID, or name.             |

Query results provide stable element references. A reference includes a document ID and an element ID or structural path; array positions are not stable identifiers.

## Flux de travail courants pour les agents

Ces exemples utilisent uniquement les fonctionnalités PPTX actuelles. Ils décrivent des flux de travail qu’un agent peut composer à partir des primitives de Deckuse, sans prétendre que Deckuse effectue lui-même du raisonnement, de la rédaction ou une révision visuelle.

### 1. Mettre à jour une année obsolète dans une présentation

**Demande :** « Remplacez chaque référence à `FY2025` par `FY2026`, sans rien modifier d’autre. »

Utilisez d’abord `query` pour examiner les éléments concernés, puis exécutez un `replaceText` littéral et validez avant l’exportation.

```sh
deckuse init master.pptx ./year-update --json
deckuse query ./year-update 'text=FY2025' --limit 1000 --json
cat > year-update.json <<'EOF'
{
  "type": "replaceText",
  "find": "FY2025",
  "replace": "FY2026"
}
EOF
deckuse apply ./year-update --input year-update.json --json
deckuse validate ./year-update --json
```

Une fois l'écriture terminée, `./year-update/package.pptx` est reconstruit automatiquement comme dernier instantané.

La requête de revue limite la modification aux occurrences connues ; `replaceText` effectue la mutation groupée approuvée tout en laissant les objets sans rapport intacts. Sans selector, il met à jour les nœuds texte indexés les plus spécifiques plutôt que les conteneurs ancêtres qui agrègent le texte descendant.

### 2. Renommer une entreprise ou un produit

**Demande :** « Remplacez partout l’ancien nom du produit par le nouveau. »

Il s’agit du même modèle sûr de revue puis remplacement. Recherchez d’abord le nom exact à remplacer, puis utilisez `replaceText` avec une valeur littérale. Pour les variantes telles que la ponctuation ou les espaces, n’utilisez un remplacement par expression régulière qu’après avoir vérifié la sortie de la requête.

```json
{
  "type": "replaceText",
  "find": "Legacy Platform",
  "replace": "Unified Platform"
}
```

Pour une modification plus restreinte, ajoutez un sélecteur dans la commande, par exemple `"selector": "slide=256"`, afin qu’une seule diapositive soit éligible.

### 3. Extraire le plan d’une présentation pour un agent

**Demande :** « Listez les titres des diapositives et résumez le contenu de cette présentation. »

Exécutez `inspect` pour récupérer la structure indexée de la présentation, puis interrogez les objets contenant du texte. L’agent appelant peut regrouper les objets retournés par ID de diapositive, identifier les objets qui ressemblent à des titres d’après leur nom, leur position ou leur texte, puis générer un résumé à partir du texte extrait.

```sh
deckuse init briefing.pptx ./outline --json
deckuse inspect ./outline --depth 2 --json
deckuse query ./outline 'hasText=true' --limit 10000 --json
```

Deckuse fournit les données sources structurées. C’est l’agent, et non Deckuse, qui détermine quel texte est un titre et qui rédige le résumé.

### 4. Effectuer un contrôle qualité du contenu avant livraison

**Demande :** « Avant l’envoi de cette présentation, trouvez les anciens noms de clients, dates, noms de produits, URL et le texte de clause de non-responsabilité requis. »

Interrogez chaque risque connu et examinez les références retournées. Les vérifications d’absence fonctionnent de la même façon : recherchez le texte requis et signalez un résultat vide. Un agent peut produire un rapport de QA sans modifier la présentation, ou préparer des commandes `setText` / `replaceText` étroitement ciblées pour des corrections approuvées.

```sh
deckuse query ./workspace 'text=Customer A' --limit 1000 --json
deckuse query ./workspace 'text~=https?://' --limit 1000 --json
deckuse query ./workspace 'text=Required disclaimer' --limit 1000 --json
```

Il s’agit d’une QA de contenu et de structure, non d’une QA visuelle. Deckuse ne rend pas les diapositives et ne détermine pas si du texte chevauche un autre contenu.

### 5. Modifier exactement un élément sur une diapositive

**Demande :** « Sur la diapositive 7, remplacez le titre par `Enterprise Strategy` ; ne modifiez rien d’autre. »

Interrogez d’abord cette diapositive et le texte du titre, puis prenez le `ref` retourné et envoyez une commande `setText`. Le `ref` évite un remplacement global ambigu.

```json
{
  "type": "setText",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:10"
  },
  "text": "Enterprise Strategy"
}
```

Les ID d’élément sont des exemples propres à une présentation. Utilisez toujours un ID retourné par l’espace de travail actuel au lieu de recopier cette valeur.

### 6. Uniformiser la typographie des titres

**Demande :** « Réglez tous les titres approuvés sur 28 pt et utilisez la police approuvée. »

Utilisez une requête pour identifier les objets de titre, faites examiner ou filtrer par l’agent les références retournées, puis appliquez `setProperties` une fois pour chaque référence approuvée. `setProperties` cible une référence à la fois ; il n’accepte pas lui-même de sélecteur.

```json
{
  "type": "setProperties",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:8"
  },
  "properties": {
    "fontSize": 28,
    "fontFamily": "Approved Sans",
    "bold": true
  }
}
```

La même commande peut définir `fill`, `stroke` (ainsi que `border`, `outline` ou `line`), `textColor`, `italic`, `underline`, `name` et `hidden`. Les clés de propriété inconnues échouent avec `INVALID_COMMAND`.

### 7. Ajuster précisément la géométrie d’un objet

**Demande :** « Déplacez légèrement vers le bas chaque titre approuvé. »

Interrogez et sélectionnez les références de titre visées, inspectez leur géométrie actuelle et émettez une commande `setTransform` par objet avec des coordonnées explicites. Il s’agit d’une opération structurelle de géométrie ; ne la présentez pas comme une correction automatique de mise en page sans validation visuelle.

```json
{
  "type": "setTransform",
  "ref": {
    "documentId": "./workspace",
    "elementId": "256:8"
  },
  "transform": {
    "x": 914400,
    "y": 731520,
    "width": 8229600,
    "height": 685800
  }
}
```

Les coordonnées de transformation sont des EMU OOXML. Conservez `x`, `width` et `height` de l’objet inspecté lorsque vous ne modifiez que sa position verticale.

### 8. Personnaliser une présentation commerciale approuvée

**Demande :** « Créez une version pour un prospect. Mettez à jour le nom du client et le texte approuvé propre au compte, tout en préservant le design. »

Créez un espace de travail distinct pour chaque résultat à partir du modèle maître approuvé. Interrogez les espaces réservés ou le texte client existant, appliquez uniquement les remplacements examinés, validez, puis utilisez le `package.pptx` mis à jour automatiquement.

```sh
deckuse init approved-master.pptx ./customer-a --json
deckuse query ./customer-a 'text=Customer Name' --json
# Appliquez uniquement les remplacements examinés pour ce client.
deckuse apply ./customer-a --input customer-a.jsonl --json
deckuse validate ./customer-a --json
```

Des espaces de travail séparés empêchent les modifications d’un client de se retrouver dans la sortie d’un autre. Ne remplacez que les objets que le processus d’approbation autorise l’agent à modifier.

### 9. Produire des variantes régionales ou par audience depuis un même modèle maître

**Demande :** « Générez des variantes régionales et enterprise à partir de la présentation approuvée. »

Initialisez un nouvel espace de travail depuis le même modèle maître pour chaque variante. Chaque variante reçoit son propre fichier de commandes et son propre chemin de sortie. Utilisez `batch` lorsqu’il est nécessaire que les modifications d’une variante soient atomiques : si une commande échoue, aucune des modifications du lot n’est persistée.

```json
{
  "type": "batch",
  "atomic": true,
  "commands": [
    {
      "type": "replaceText",
      "find": "Default Message",
      "replace": "Regional Message"
    },
    {
      "type": "replaceText",
      "find": "Default Offer",
      "replace": "Enterprise Offer"
    }
  ]
}
```

Cela préserve une source unique approuvée tout en rendant chaque variante reproductible à partir d’un ensemble explicite de modifications.

### 10. Permettre à un agent de code d’opérer une présentation existante

**Demande :** « Inspectez cette présentation, identifiez les modifications demandées, effectuez-les et exportez un PPTX révisé. »

Donnez à l’agent cette boucle : initialiser un espace de travail, inspecter ou interroger avant chaque modification ciblée, générer des commandes JSON explicites, les appliquer, valider le package et utiliser le `package.pptx` reconstruit comme export. Lorsque l’auditabilité importe, conservez le fichier de commandes et les résultats des commandes avec la tâche.

Deckuse fournit à l’agent des références stables, des sélecteurs, des transactions, une validation et un chemin d’exportation déterministe. L’agent interprète la tâche et décide quelles opérations sont appropriées.

### Exemple de `setProperties`

```json
{
  "type": "setProperties",
  "ref": { "documentId": "./workspace", "elementId": "256:8" },
  "properties": {
    "stroke": { "color": "0000FF", "width": 1.5 },
    "fill": "none",
    "textColor": "111111",
    "fontSize": 18,
    "fontFamily": "Approved Sans",
    "bold": true
  }
}
```

`stroke` and `fill` accept a hexadecimal color string. Use `none`, `false`, or `null` for no stroke or fill. `stroke.width` is in points and defaults to `1`.

## Fonctionnalités PPTX

- Persistent workspaces, revision-conflict detection, dry runs, atomic batches, and an operation log.
- `inspect`, `query`, and `getText`; stable references include slide ID, part URI, cNvPr ID, and ancestor path when available.
- `setText` and `replaceText`, including literal or regular-expression replacement in an optional selector scope. Without a selector, `replaceText` prefers leaf text nodes over ancestor containers that aggregate descendant text.
- `setTransform` for explicit object position, size, rotation, and flip changes.
- `setProperties` for common shape and text properties.
- Add, duplicate, and remove slides; duplicated slides clone mutable notes and chart parts while layouts and media can be shared safely.
- Add shapes/text boxes, connectors, groups, pictures (from a file path or base64), and tables; duplicate or remove elements.
- `replacePicture` replaces embedded media in place while retaining the element reference and layer order.
- Table-cell addressing; speaker-note reading and text editing.
- Chart title, series-name, and cached-value edits. An embedded workbook causes `EMBEDDED_WORKBOOK_NOT_SYNCHRONIZED` rather than a claim that workbook data was updated.
- Common text and `srgbClr` color edits in master, layout, and theme parts.
- Preservation of unknown parts and untouched nodes. ZIP files are recompressed, so fidelity refers to uncompressed data for untouched entries, not ZIP byte identity.

## Limites

- Deckuse does not implement the full PowerPoint DrawingML surface, animation editing, SmartArt editing, OLE editing, or macro editing.
- It does not render presentations. Do not rely on it to assess visual quality, detect overlap, or automatically improve slide design.
- Chart edits update OOXML chart caches only; embedded Excel workbooks are not rewritten.
- Duplicated slides clone notes and chart parts and reuse layouts, themes, and media. Complex custom XML extensions are retained but not edited semantically.
- `setText` and `replaceText` collapse multi-run text in the targeted node into one run while retaining the first run’s style.

## Vérifications de développement

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For the complete canonical English documentation and command wording, see [README.md](README.md).
