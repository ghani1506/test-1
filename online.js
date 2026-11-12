/* Finds recipes in TheMealDB, an online recipe database, and checks them in the browser. */
(function (root, factory) {
  const api = factory(root.RecipeCore);
  root.OnlineRecipes = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function (C) {
  const API = "https://www.themealdb.com/api/json/v1/";
  const NEGLIGIBLE = /\b(salt|water|ice|yeast|baking powder|baking soda|bicarbonate|vanilla|gelatine|gelatin|food colouring|cooking spray)\b/;
  const STAPLE = /^(salt|sea salt|black pepper|pepper|water|ice|oil|olive oil|vegetable oil|sunflower oil|cooking oil|extra virgin olive oil|groundnut oil|rapeseed oil)$/;
  const SEASONING = /\b(salt|pepper|spice|powder|seeds?|paprika|cumin|turmeric|cinnamon|nutmeg|clove|cardamom|garam|masala|oregano|thyme|basil|parsley|rosemary|sage|bay|mint|dill|chives|coriander|cilantro|vinegar|sauce|ketchup|mustard|paste|stock|bouillon|oil|sugar|honey|syrup|extract|flour|yeast|baking|garlic|ginger|chilli|chili|lemon|lime|zest|juice|sesame|herbs?)\b/;
  const NON_HALAL = ["pork", "bacon", "ham", "gammon", "lard", "prosciutto", "pancetta", "chorizo", "salami", "pepperoni", "sausage", "gelatine", "gelatin", "wine", "beer", "ale", "stout", "lager", "cider", "rum", "brandy", "sherry", "vodka", "whisky", "whiskey", "bourbon", "port", "marsala", "mirin", "sake", "kirsch", "cognac", "liqueur", "tequila", "gin", "champagne", "prosecco"];
  const MEAT_FISH = ["chicken", "beef", "pork", "lamb", "mutton", "goat", "duck", "turkey", "bacon", "ham", "sausage", "chorizo", "salami", "pepperoni", "pancetta", "prosciutto", "mince", "steak", "veal", "venison", "rabbit", "fish", "salmon", "tuna", "cod", "haddock", "mackerel", "prawn", "shrimp", "crab", "lobster", "mussel", "clam", "squid", "anchovy", "sardine", "oyster", "scallop", "gelatine", "gelatin", "lard", "suet", "stock", "fish sauce", "worcestershire", "oyster sauce"];
  const ANIMAL = ["milk", "butter", "cream", "cheese", "yoghurt", "yogurt", "egg", "honey", "ghee", "mayonnaise", "parmesan", "mozzarella", "feta", "custard", "creme fraiche"];
  const MEAT_CATEGORIES = ["Beef", "Chicken", "Lamb", "Pork", "Seafood", "Goat"];
  const SWAPS = [
    [/\bbutter\b/, "Use about half the butter, or swap some for olive oil."],
    [/\b(double cream|heavy cream|whipping cream|cream)\b/, "Use plain low-fat yoghurt or light coconut milk for some of the cream."],
    [/\bsugar\b/, "Use about half the sugar."],
    [/\b(bacon|sausage|pork belly|chorizo|pancetta|salami)\b/, "Use less processed meat, or swap it for lean chicken."],
    [/\b(white rice|basmati rice|jasmine rice|long grain rice|rice)\b/, "Use brown rice for more fibre."],
    [/\b(spaghetti|pasta|penne|linguine|tagliatelle|fusilli|lasagne)\b/, "Use wholewheat pasta for more fibre."],
    [/\b(plain flour|all purpose flour|breadcrumbs)\b/, "Use wholemeal flour or breadcrumbs where you can."],
    [/\b(stock cube|bouillon|soy sauce|fish sauce)\b/, "Choose low-salt stock or sauce, and taste before adding salt."],
    [/\b(cheese|parmesan|cheddar|mozzarella)\b/, "Use a smaller amount of a strong-tasting cheese."],
    [/\bmayonnaise\b/, "Mix the mayonnaise half and half with plain yoghurt."],
  ];
  const UTENSIL_WORDS = [
    ["oven", /\b(oven|bake|baked|baking|roast|roasting|preheat)\b/], ["baking tray", /\b(baking tray|baking sheet|baking dish|roasting tin|roasting pan|ovenproof dish|tin)\b/],
    ["pot", /\b(saucepan|pot|boil|boiling|simmer|casserole|stockpot)\b/], ["pan", /\b(frying pan|skillet|wok|fry|fried|frying|saute|sauté|stir-fry|stir fry|brown the)\b/],
    ["blender", /\b(blend|blender|food processor|puree|purée|whizz|liquidise)\b/], ["grill", /\b(grill|griddle|barbecue|bbq|broil)\b/],
    ["steamer", /\b(steam|steamer)\b/], ["mixing bowl", /\b(bowl)\b/], ["foil", /\b(foil)\b/],
  ];

  const words = (t) => new Set(C.normWords(t).filter((w) => w.length > 2));
  const subset = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));
  const hasWord = (text, list) => list.some((w) => new RegExp(`(?<![a-z])${w}(?:s|es)?(?![a-z])`).test(text));
  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  function matchesUser(name, userItems, userFoods) {
    const n = words(name);
    if (userItems.some((item) => { const u = words(item); return subset(u, n) || subset(n, u); })) return true;
    return [...C.resolveFood(name)].some((f) => userFoods.has(f));
  }

  function parseMeasure(measure) {
    let s = (measure || "").toLowerCase().replace(/½/g, " 1/2").replace(/¼/g, " 1/4").replace(/¾/g, " 3/4").replace(/⅓/g, " 1/3").replace(/⅔/g, " 2/3").trim();
    if (!s || /to taste|pinch|dash|garnish|to serve|sprinkle|for frying|optional|as required|as needed/.test(s)) return { negligible: true };
    const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(?:-\s*\d*\.?\d+)?\s*/);
    let qty = 1;
    if (m) {
      const t = m[1].trim();
      qty = t.includes("/") ? t.split(/\s+/).reduce((sum, part) => { const [a, b] = part.split("/"); return sum + (b ? +a / +b : +a); }, 0) : parseFloat(t);
      s = s.slice(m[0].length);
    }
    const unitMatch = s.match(/^(kg|g|gr|grams?|ml|l|litres?|liters?|tsp|teaspoons?|tbsp|tbs|tblsp|tbls|tablespoons?|cups?|oz|ounces?|lbs?|pounds?|cloves?|cans?|tins?|slices?|stalks?|sticks?|handfuls?|large|medium|small|whole|pieces?|fillets?|bunch(?:es)?)\b/);
    const unit = unitMatch ? unitMatch[1] : "";
    return { qty, unit };
  }

  function gramsFor(food, qty, unit) {
    if (/^(g|gr|grams?)$/.test(unit)) return qty;
    if (unit === "kg") return qty * 1000;
    if (unit === "ml") return qty;
    if (/^(l|litres?|liters?)$/.test(unit)) return qty * 1000;
    if (/^(tsp|teaspoons?)$/.test(unit)) return qty * food.tsp;
    if (/^(tbsp|tbs|tblsp|tbls|tablespoons?)$/.test(unit)) return qty * food.tsp * 3;
    if (/^cups?$/.test(unit)) return qty * food.tsp * 48;
    if (/^(oz|ounces?)$/.test(unit)) return qty * 28.35;
    if (/^(lbs?|pounds?)$/.test(unit)) return qty * 453.6;
    if (/^(cans?|tins?)$/.test(unit)) return qty * 400;
    if (/^handfuls?$/.test(unit)) return qty * 30;
    if (/^bunch/.test(unit)) return qty * 30;
    if (/^fillets?$/.test(unit)) return qty * 140;
    return food.each ? qty * food.each : null;
  }

  function estimateNutrition(ingredients, servings) {
    const totals = Array(8).fill(0);
    let covered = 0, counted = 0;
    for (const { name, amount } of ingredients) {
      const lower = name.toLowerCase(), parsed = parseMeasure(amount);
      counted++;
      if (parsed.negligible || NEGLIGIBLE.test(lower)) { covered++; continue; }
      const food = C.DATA.foods.find((f) => C.resolveFood(name).has(f.name));
      if (!food) continue;
      const weight = gramsFor(food, parsed.qty, parsed.unit);
      if (weight == null) continue;
      covered++;
      food.n.forEach((v, i) => { totals[i] += v * weight / 100; });
    }
    const keys = ["calories_per_serving", "protein_g", "carbs_g", "fat_g", "saturated_fat_g", "sugar_g", "fibre_g", "sodium_mg"];
    return { nutrition: Object.fromEntries(keys.map((k, i) => [k, totals[i] / servings])), coverage: counted ? covered / counted : 0 };
  }

  function splitSteps(text) {
    let parts = (text || "").split(/\r?\n+/).map((p) => p.replace(/^\s*(step\s*\d+[:.)]?|\d+[.)])\s*/i, "").trim()).filter((p) => p && !/^step\s*\d*$/i.test(p));
    if (parts.length === 1 && parts[0].length > 300) {
      const sentences = parts[0].match(/[^.!?]+[.!?]+(\s|$)/g) || [parts[0]];
      parts = [];
      for (let i = 0; i < sentences.length; i += 2) parts.push(sentences.slice(i, i + 2).join("").trim());
    }
    return parts;
  }

  function inferUtensils(text) {
    const lower = text.toLowerCase();
    return UTENSIL_WORDS.filter(([, re]) => re.test(lower)).map(([name]) => name);
  }

  function dietProblems(meal, ingredientText, diets) {
    const problems = [];
    if (diets.includes("Halal") && (meal.strCategory === "Pork" || hasWord(ingredientText.replace(/wine vinegar|rice vinegar|ginger ale/g, " "), NON_HALAL))) problems.push("Halal");
    const meaty = MEAT_CATEGORIES.includes(meal.strCategory) || hasWord(ingredientText.replace(/vegetable stock|vegetable broth/g, " "), MEAT_FISH);
    if ((diets.includes("Vegetarian") || diets.includes("Vegan")) && meaty) problems.push("Vegetarian");
    if (diets.includes("Vegan") && hasWord(ingredientText.replace(/coconut milk|coconut cream|almond milk|oat milk|soy milk|peanut butter|eggplant/g, " "), ANIMAL)) problems.push("Vegan");
    return problems;
  }

  function convertMeal(meal, o, userFoods) {
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
      const name = (meal[`strIngredient${i}`] || "").trim();
      if (name) ingredients.push({ name, amount: (meal[`strMeasure${i}`] || "").trim(), healthy_note: "" });
    }
    const steps = splitSteps(meal.strInstructions);
    const { nutrition, coverage } = estimateNutrition(ingredients, o.servings);
    const lowerIngredients = ingredients.map((i) => i.name.toLowerCase()).join(", ");
    const allText = `${lowerIngredients} ${(meal.strInstructions || "").toLowerCase()}`;
    const swaps = SWAPS.filter(([re]) => re.test(lowerIngredients)).map(([, t]) => t);
    if (/deep[- ]?fr(y|ied)/.test(allText)) swaps.push("Bake or air-fry at about 200°C instead of deep-frying, until cooked through.");
    const used = ingredients.filter((i) => matchesUser(i.name, o.ingredients, userFoods));
    const missing = ingredients.filter((i) => !STAPLE.test(i.name.toLowerCase()) && !matchesUser(i.name, o.ingredients, userFoods));
    const missingMain = missing.filter((i) => !SEASONING.test(i.name.toLowerCase()));
    const vegCount = ingredients.filter((i) => [...C.resolveFood(i.name)].some((f) => (C.FOODS[f] || {}).cat === "v" && (C.FOODS[f] || {}).role === "main")).length;
    const addons = [];
    if (vegCount < 2) addons.push("A side of steamed greens or a mixed salad");
    if (!/\b(rice|pasta|spaghetti|noodle|bread|potato|couscous|quinoa|tortilla)/.test(lowerIngredients)) addons.push("Brown rice or wholemeal bread on the side");
    addons.push("Fresh fruit to finish", "Water or unsweetened tea to drink");
    const source = meal.strSource && /^https?:\/\//.test(meal.strSource) ? meal.strSource : "";
    const recipe = {
      title: meal.strMeal, description: [meal.strArea && meal.strArea !== "Unknown" ? meal.strArea : "", (meal.strCategory || "").toLowerCase(), "recipe"].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase()) + ".",
      servings: o.servings, prep_minutes: null, cook_minutes: null, difficulty: steps.length <= 5 ? "Easy" : "Medium", ingredients,
      utensils: inferUtensils(`${meal.strInstructions} ${meal.strMeal}`), steps, nutrition, healthy_choices: [], healthier_swaps: swaps,
      add_on_suggestions: addons.filter((a) => !C.findAllergenHits(a, o.allergens).length), allergens_present: C.COMMON_ALLERGENS.filter((a) => C.findAllergenHits(lowerIngredients, [a]).length),
      hidden_allergens: [], origin: "online", coverage, area: meal.strArea || "", category: meal.strCategory || "",
      photo_url: meal.strMealThumb || "", video_url: /^https:\/\//.test(meal.strYoutube || "") ? meal.strYoutube : "", source_url: source,
      mealdb_url: `https://www.themealdb.com/meal/${encodeURIComponent(meal.idMeal)}`, dish_image_search: "", ingredient_image_searches: used.slice(0, 3).map((i) => i.name),
    };
    return { recipe, used, missing, missingMain, allText };
  }

  function utensilCheck(recipe, utensils, basics) {
    const kit = C.recognise(utensils, C.resolveUtensil).known;
    if (basics) C.DATA.basicUtensils.forEach((u) => kit.add(u));
    const missing = [], swaps = [];
    for (const u of recipe.utensils) {
      if (kit.has(u)) continue;
      const alt = (C.DATA.utensilAlternatives[u] || []).find((a) => [...C.resolveUtensil(a.name)].some((k) => kit.has(k)));
      if (alt) swaps.push(`No ${u}? ${alt.name[0].toUpperCase() + alt.name.slice(1)}: ${alt.how_to_use}`); else missing.push(u);
    }
    return { missing, swaps };
  }

  async function getJson(url, fetchFn) {
    const resp = await fetchFn(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function pool(items, limit, fn) {
    const out = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const i = next++; try { out[i] = await fn(items[i]); } catch (e) { out[i] = null; } }
    }));
    return out;
  }

  let ingredientList = null;
  async function searchTerms(items, base, fetchFn) {
    if (!ingredientList) {
      try { ingredientList = ((await getJson(`${base}list.php?i=list`, fetchFn)).meals || []).map((m) => m.strIngredient).filter(Boolean); } catch (e) { ingredientList = []; }
    }
    const terms = [];
    for (const item of items) {
      if (STAPLE.test(item.toLowerCase())) continue;
      const names = [item, ...[...C.resolveFood(item)].flatMap((f) => [f, ...(C.FOODS[f] || { aliases: [] }).aliases.filter((a) => /^[a-z ]+$/.test(a))])];
      const picked = [];
      for (const name of names) {
        const w = C.normWords(name).join(" ");
        const exact = ingredientList.find((l) => C.normWords(l).join(" ") === w);
        if (exact && !picked.includes(exact)) picked.push(exact);
      }
      const iw = words(item);
      ingredientList.filter((l) => subset(iw, words(l)) && !picked.includes(l)).sort((a, b) => a.length - b.length).slice(0, 2).forEach((l) => picked.push(l));
      if (!picked.length) picked.push(titleCase(item));
      for (const p of picked.slice(0, 3)) if (!terms.includes(p)) terms.push(p);
    }
    return terms.slice(0, 16);
  }

  async function findOnline(o, fetchFn = fetch) {
    const base = `${API}${encodeURIComponent(o.apiKey || "1")}/`;
    const allergens = C.expandAllergens(o.allergens);
    const userFoods = C.recognise(o.ingredients, C.resolveFood).known;
    const terms = await searchTerms(o.ingredients, base, fetchFn);
    const lists = await pool(terms, 6, (t) => getJson(`${base}filter.php?i=${encodeURIComponent(t.replace(/ /g, "_"))}`, fetchFn));
    if (lists.every((l) => l === null)) throw new Error("The online recipe database could not be reached.");
    const hits = new Map();
    lists.forEach((l) => ((l && Array.isArray(l.meals)) ? l.meals : []).forEach((m) => hits.set(m.idMeal, (hits.get(m.idMeal) || 0) + 1)));
    const ids = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([id]) => id);
    const meals = (await pool(ids, 6, (id) => getJson(`${base}lookup.php?i=${encodeURIComponent(id)}`, fetchFn))).map((r) => r && r.meals && r.meals[0]).filter(Boolean);
    const matches = [], skipped = { allergens: 0, diet: 0, health: 0, other: 0 };
    for (const meal of meals) {
      const { recipe, used, missing, missingMain, allText } = convertMeal(meal, { ...o, allergens }, userFoods);
      if (!recipe.steps.length || !recipe.ingredients.length) { skipped.other++; continue; }
      const allergenHits = C.findAllergenHits(`${recipe.title} ${allText}`, allergens);
      if (allergenHits.length) { skipped.allergens++; continue; }
      if (dietProblems(meal, allText, o.diets).length) { skipped.diet++; continue; }
      if (o.meal === "Breakfast" && meal.strCategory !== "Breakfast") { skipped.other++; continue; }
      if (o.meal === "Lunch or dinner" && ["Breakfast", "Dessert"].includes(meal.strCategory)) { skipped.other++; continue; }
      const flags = C.healthFlags(recipe), n = recipe.nutrition, reliable = recipe.coverage >= 0.6;
      const nutritionDiet = { "Lower sugar": n.sugar_g <= 10, "Lower salt": n.sodium_mg <= 500, "High protein": n.protein_g >= 25 };
      if (reliable && o.diets.some((d) => nutritionDiet[d] === false)) { skipped.diet++; continue; }
      if (o.healthyOnly && (meal.strCategory === "Dessert" || /deep[- ]?fr(y|ied)/.test(allText) || (reliable && flags.length >= 2))) { skipped.health++; continue; }
      if (!used.length || missingMain.length > o.maxMissing) { skipped.other++; continue; }
      const kit = utensilCheck(recipe, o.utensils, o.basics);
      if (kit.missing.length && !o.allowOtherUtensils) { skipped.other++; continue; }
      const score = used.length * 2 - missingMain.length - 0.3 * (missing.length - missingMain.length) - flags.length;
      matches.push({ recipe, score, missing_ingredients: missing.map((i) => i.name), ingredient_swaps: [], missing_utensils: kit.missing, utensil_swaps: kit.swaps });
    }
    matches.sort((a, b) => b.score - a.score);
    return { matches: matches.slice(0, o.count), removed: skipped.allergens, skipped, searched: meals.length };
  }

  return { findOnline, parseMeasure, estimateNutrition, splitSteps, inferUtensils, dietProblems, _reset: () => { ingredientList = null; } };
});
