/* Connects the page to the recipe logic, photos and PDF writer. */
(function () {
  const C = window.RecipeCore;
  const $ = (id) => document.getElementById(id);
  const CONFIG = window.RECIPE_CONFIG || {};
  const WORKER_URL = (CONFIG.workerUrl || "").trim();
  const aiAuth = () => (WORKER_URL ? { workerUrl: WORKER_URL } : "");

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  }

  function addQuick(container, target, items) {
    const current = () => C.parseItems(target.value).map((i) => i.toLowerCase());
    const buttons = items.map((name) => {
      const b = el("button", { type: "button", textContent: name, onclick: () => {
        const list = C.parseItems(target.value), idx = list.findIndex((i) => i.toLowerCase() === name);
        if (idx >= 0) list.splice(idx, 1); else list.push(name);
        target.value = list.join(", "); sync();
      } });
      container.append(b);
      return b;
    });
    const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(current().includes(b.textContent))));
    target.addEventListener("input", sync);
    sync();
  }
  addQuick($("quick-ingredients"), $("ingredients"), ["chicken", "fish", "egg", "tofu", "rice", "noodles", "tomato", "cabbage", "garlic", "onion", "chilli", "soy sauce"]);
  addQuick($("quick-utensils"), $("utensils"), ["wok", "pot", "oven", "steamer", "rice cooker", "blender"]);

  const checks = (box, names, cls) => names.forEach((name) => box.append(el("label", { class: "check" }, el("input", { type: "checkbox", value: name, className: cls }), name)));
  checks($("allergens"), C.COMMON_ALLERGENS, "allergen");
  checks($("diets"), C.DIETS, "diet");
  const checked = (cls) => [...document.querySelectorAll(`input.${cls}:checked`)].map((i) => i.value);
  $("diets").addEventListener("change", () => { $("halal-note").hidden = !checked("diet").includes("Halal"); });

  const clamp = (id, low, high, fallback) => {
    const v = parseInt($(id).value, 10);
    return Number.isNaN(v) ? fallback : Math.min(high, Math.max(low, v));
  };

  /* Photos from Wikimedia Commons */
  const COMMONS = "https://commons.wikimedia.org/w/api.php";
  const ALLOWED = ["cc0", "public domain", "pd", "cc by", "cc-by"];
  const BLOCKED = new Set(["logo", "map", "diagram", "icon", "chart", "stamp", "drawing", "illustration", "cartoon", "poster"]);
  const photoCache = new Map();
  const plain = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
  const words = (t) => new Set((t.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2).map((w) => w.replace(/s+$/, "")));

  function dataUrlBytes(url) {
    const bin = atob(url.split(",")[1]), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function makePhoto(bitmap, info) {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = el("canvas", { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { ...info, url: canvas.toDataURL("image/jpeg", 0.85), crop(ratio) {
      const srcRatio = canvas.width / canvas.height;
      const sw = srcRatio > ratio ? Math.round(canvas.height * ratio) : canvas.width, sh = srcRatio > ratio ? canvas.height : Math.round(canvas.width / ratio);
      const out = el("canvas", { width: sw, height: sh });
      out.getContext("2d").drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, sw, sh);
      return { width: sw, height: sh, bytes: dataUrlBytes(out.toDataURL("image/jpeg", 0.85)) };
    } };
  }
  async function findPhoto(term) {
    if (!term || !term.trim()) return null;
    if (photoCache.has(term)) return photoCache.get(term);
    const task = (async () => {
      const q = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "12", gsrsearch: `${term} filetype:bitmap`, prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "1200" });
      try {
        const data = await (await fetch(`${COMMONS}?${q}`)).json();
        const pages = Object.values((data.query || {}).pages || {}).sort((a, b) => (a.index || 999) - (b.index || 999));
        const wanted = words(term);
        for (const page of pages) {
          const info = (page.imageinfo || [{}])[0], meta = info.extmetadata || {};
          const licence = plain((meta.LicenseShortName || {}).value), titleWords = words(page.title || "");
          const searchable = new Set([...titleWords, ...words(plain((meta.ObjectName || {}).value))]);
          const url = info.thumburl || info.url || "";
          if (!ALLOWED.some((a) => licence.toLowerCase().startsWith(a)) || [...titleWords].some((w) => BLOCKED.has(w)) || ![...wanted].every((w) => searchable.has(w))
            || !["image/jpeg", "image/png", "image/webp"].includes(info.mime) || !url.startsWith("https://upload.wikimedia.org/")) continue;
          try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const bitmap = await createImageBitmap(await resp.blob());
            if (Math.min(bitmap.width, bitmap.height) < 300) continue;
            return makePhoto(bitmap, { label: term, credit: `${(plain((meta.Artist || {}).value) || "Unknown author").slice(0, 90)}, ${licence}, via Wikimedia Commons`, source_url: info.descriptionurl || url });
          } catch (e) { /* Try the next photo. */ }
        }
      } catch (e) { /* Recipes still work without photos. */ }
      return null;
    })();
    photoCache.set(term, task);
    return task;
  }
  async function recipePhotos(recipe) {
    const terms = [recipe.dish_image_search, ...recipe.ingredient_image_searches.slice(0, 3)];
    const found = await Promise.all(terms.map(findPhoto));
    return found.map((p, i) => (p ? { ...p, crop: p.crop, is_dish: i === 0 } : null)).filter(Boolean);
  }

  async function photoFromUrl(url, info) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return makePhoto(await createImageBitmap(await resp.blob()), info);
    } catch (e) { return null; }
  }
  async function onlinePhotos(r) {
    const tasks = [r.photo_url ? photoFromUrl(r.photo_url, { label: r.title, credit: "TheMealDB", source_url: r.mealdb_url, is_dish: true }) : null,
      ...r.ingredient_image_searches.map((name) => photoFromUrl(`https://www.themealdb.com/images/ingredients/${encodeURIComponent(name)}.png`, { label: name, credit: "TheMealDB", source_url: "https://www.themealdb.com" }))];
    const found = (await Promise.all(tasks)).filter(Boolean);
    if (found.length) return found;
    return (await Promise.all(r.ingredient_image_searches.map(findPhoto))).filter(Boolean);
  }
  const photosFor = (r) => (r.origin === "online" ? onlinePhotos(r) : recipePhotos(r));

  /* Results */
  let state = null;

  function renderResults() {
    const box = $("results");
    box.replaceChildren();
    if (!state) return;
    if (state.notice) box.append(el("p", { class: "warn", textContent: state.notice }));
    if (state.unknown.length) box.append(el("p", { class: "warn", textContent: `Not recognised for built-in matching: ${state.unknown.join(", ")}` }));
    if (state.removed) box.append(el("p", { class: "small", textContent: `${state.removed} recipe${state.removed === 1 ? " was" : "s were"} excluded by the allergen check.` }));
    if (state.skipped && (state.skipped.diet || state.skipped.health)) box.append(el("p", { class: "small", textContent: [state.skipped.diet ? `${state.skipped.diet} hidden by your dietary requirements` : "", state.skipped.health ? `${state.skipped.health} hidden as less healthy` : ""].filter(Boolean).join(", ") + "." }));
    if (!state.matches.length) {
      box.append(el("div", { class: "empty" }, el("h2", { textContent: "No recipes matched" }), el("p", { textContent: "Add more ingredients, or open Recipe options and allow more minutes, more ingredients to buy or other utensils." })));
      return;
    }
    const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "Recipes" });
    const panel = el("div", {});
    state.matches.forEach((m, i) => {
      tabs.append(el("button", { type: "button", role: "tab", textContent: m.recipe.title, "aria-selected": String(i === state.active), onclick: () => { state.active = i; renderResults(); } }));
    });
    box.append(tabs, panel);
    renderRecipe(panel, state.matches[state.active]);
  }

  function renderRecipe(panel, match) {
    const r = match.recipe, n = r.nutrition, online = r.origin === "online", total = online ? 0 : r.prep_minutes + r.cook_minutes;
    const article = el("article", { class: "recipe" }, el("h2", { textContent: r.title }), el("p", { class: "desc", textContent: r.description }));
    const photoBox = el("div", {});
    article.append(photoBox);
    article.append(el("div", { class: "facts" },
      el("div", { class: "cal" }, el("b", { textContent: `${Math.round(n.calories_per_serving)} kcal` }), el("span", { textContent: "per serving (estimate)" })),
      el("div", {}, el("b", { textContent: Math.round(n.calories_per_serving * r.servings).toString() }), el("span", { textContent: "kcal whole recipe" })),
      online ? el("div", {}, el("b", { textContent: r.area && r.area !== "Unknown" ? r.area : r.category || "-" }), el("span", { textContent: r.area && r.area !== "Unknown" ? "cuisine" : "type" }))
        : el("div", {}, el("b", { textContent: `${total} min` }), el("span", { textContent: "total time" })),
      el("div", {}, el("b", { textContent: String(r.servings) }), el("span", { textContent: r.servings === 1 ? "person" : "people" }))));
    if (online) {
      const links = el("p", { class: "notice" }, "Recipe from ", el("a", { href: r.mealdb_url, target: "_blank", rel: "noopener", textContent: "TheMealDB" }));
      if (r.source_url) links.append(", originally from ", el("a", { href: r.source_url, target: "_blank", rel: "noopener", textContent: new URL(r.source_url).hostname.replace(/^www\./, "") }));
      if (r.video_url) links.append(". ", el("a", { href: r.video_url, target: "_blank", rel: "noopener", textContent: "Watch the video" }));
      links.append(".");
      article.append(links);
    }
    article.append(el("p", { class: "small", textContent: online
      ? `Online recipe. The source doesn't give servings, so calories are the whole recipe divided by ${r.servings}. Nutrition is estimated from ${Math.round(r.coverage * 100)}% of the ingredients${r.coverage < 0.6 ? ", so treat it as very rough" : ""}.`
      : r.origin === "ai" ? "AI-created recipe. Nutrition figures are AI estimates, so check that the steps and amounts look sensible." : "Built-in recipe. Nutrition figures are estimates from a food table." }));
    C.healthFlags(r).forEach((f) => article.append(el("p", { class: "warn", textContent: f })));
    if (state.allergens.length) article.append(el("p", { class: "notice", textContent: `Automatic checks found none of your allergens: ${state.allergens.join(", ")}. Always read product labels and check for cross-contamination.` }));
    else if (r.allergens_present.length) article.append(el("p", { class: "notice", textContent: `Contains or may contain: ${r.allergens_present.join(", ")}.` }));
    const notes = [];
    if (match.missing_ingredients.length) notes.push(`Ingredients to buy: ${match.missing_ingredients.join(", ")}`);
    if (match.missing_utensils.length) notes.push(`Utensils you may need: ${match.missing_utensils.join(", ")}`);
    notes.forEach((t) => article.append(el("p", { class: "warn", textContent: t })));
    const swaps = [...match.ingredient_swaps, ...match.utensil_swaps];
    swaps.forEach((t) => article.append(el("p", { class: "notice", textContent: t })));

    article.append(el("div", { class: "columns" },
      el("div", {}, el("h3", { textContent: "Ingredients" }),
        el("ul", { class: "ing" }, r.ingredients.map((i) => el("li", {}, el("b", { textContent: i.amount }), el("span", { textContent: i.name + (i.healthy_note ? ` (${i.healthy_note})` : "") })))),
        el("h3", { textContent: "Utensils" }), el("p", { textContent: (r.utensils.join(", ") || "Not stated") + (online ? " (worked out from the method)" : "") })),
      el("div", {}, el("h3", { textContent: "Method" }), el("ol", { class: "steps" }, r.steps.map((s) => el("li", { textContent: s }))),
        !online && r.servings > 2 ? el("p", { class: "small", textContent: "Times are for 2 servings. Larger amounts may take longer and need bigger pans." }) : null)));
    article.append(el("h3", { textContent: "Nutrition per serving (estimated)" }), el("table", { class: "nutri" }, el("tbody", {}, [["Protein", `${Math.round(n.protein_g)} g`], ["Carbohydrate", `${Math.round(n.carbs_g)} g`], ["Fat", `${Math.round(n.fat_g)} g`], ["Saturated fat", `${Math.round(n.saturated_fat_g)} g`], ["Sugar", `${Math.round(n.sugar_g)} g`], ["Fibre", `${Math.round(n.fibre_g)} g`], ["Sodium", `${Math.round(n.sodium_mg)} mg`]].map(([k, v]) => el("tr", {}, el("th", { scope: "row", textContent: k }), el("td", { textContent: v }))))));
    if (r.healthy_choices.length) article.append(el("h3", { textContent: "Why it's healthy" }), el("ul", {}, r.healthy_choices.map((t) => el("li", { textContent: t }))));
    if ((r.healthier_swaps || []).length) article.append(el("h3", { textContent: "Make it healthier" }), el("ul", {}, r.healthier_swaps.map((t) => el("li", { textContent: t }))));
    if (r.add_on_suggestions.length) article.append(el("h3", { textContent: "Add-on suggestions" }), el("ul", {}, r.add_on_suggestions.map((t) => el("li", { textContent: t }))));

    const ingredientBox = el("div", {});
    article.append(ingredientBox);
    const download = el("button", { type: "button", class: "secondary download", textContent: "Download recipe PDF", onclick: async () => {
      download.disabled = true; download.textContent = "Preparing PDF...";
      try {
        const photos = await photosFor(r);
        const blob = window.buildRecipePdf(r, photos, state.allergens, [...notes, ...swaps], C.healthFlags(r));
        const url = URL.createObjectURL(blob), name = r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recipe";
        const a = el("a", { href: url, download: `${name}.pdf` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } finally { download.disabled = false; download.textContent = "Download recipe PDF"; }
    } });
    article.append(download);
    panel.replaceChildren(article);

    const owner = state;
    if (online) {
      if (r.photo_url) photoBox.append(el("img", { class: "hero", src: r.photo_url, alt: `Photo of ${r.title}` }), el("p", { class: "credit", textContent: "Photo: TheMealDB" }));
      if (r.ingredient_image_searches.length) ingredientBox.append(el("h3", { textContent: "Key ingredients" }), el("div", { class: "thumbs" }, r.ingredient_image_searches.map((name) => el("figure", {}, el("img", { class: "ingredient-photo", src: `https://www.themealdb.com/images/ingredients/${encodeURIComponent(name)}.png`, alt: name }), el("figcaption", { textContent: name })))));
      return;
    }
    recipePhotos(r).then((photos) => {
      if (owner !== state || !article.isConnected) return;
      const dish = photos.find((p) => p.is_dish), others = photos.filter((p) => !p.is_dish);
      if (dish) photoBox.append(el("img", { class: "hero", src: dish.url, alt: `Photo of ${dish.label}, similar to this recipe` }), el("p", { class: "credit", textContent: `Similar dish for illustration. Photo: ${dish.credit}` }));
      if (others.length) ingredientBox.append(el("h3", { textContent: "Key ingredients" }), el("div", { class: "thumbs" }, others.map((p) => el("figure", {}, el("img", { src: p.url, alt: p.label }), el("figcaption", { textContent: `${p.label}: ${p.credit}` })))));
    });
  }

  function allergensFromForm() {
    return C.expandAllergens([...checked("allergen"), ...C.parseItems($("other-allergens").value)]);
  }
  function showError(message) {
    $("form-error").textContent = message; $("form-error").hidden = !message;
  }

  $("kitchen").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const allergens = allergensFromForm(), noAllergens = $("no-allergens").checked, basics = $("basics").checked;
    const ingredients = C.parseItems($("ingredients").value), utensils = C.parseItems($("utensils").value);
    const excluded = ingredients.filter((i) => C.findAllergenHits(i, allergens).length), usable = ingredients.filter((i) => !excluded.includes(i));
    if (!usable.length) return showError("Enter at least one ingredient that is safe for you.");
    if (!utensils.length && !basics) return showError("Enter at least one utensil.");
    if (allergens.length && noAllergens) return showError("You selected allergens and also ticked 'I have no allergens to avoid'. Correct one of them.");
    if (!allergens.length && !noAllergens) return showError("Select your allergens, or tick 'I have no allergens to avoid'.");

    const o = { ingredients: usable, utensils, allergens, diets: checked("diet"), servings: clamp("servings", 1, 12, 4), count: clamp("count", 1, 5, 3), maxMinutes: clamp("time", 5, 180, 60), maxMissing: clamp("missing", 0, 5, 2), meal: $("meal").value, basics, allowOtherUtensils: $("other-utensils").checked, healthyOnly: $("healthy-only").checked, apiKey: CONFIG.mealdbKey || "1" };
    const button = $("find");
    let matches = [], removed = 0, notice = excluded.length ? `Not used because they match an allergen: ${excluded.join(", ")}. ` : "", skipped = null;
    button.disabled = true; button.textContent = "Searching online...";
    try {
      const found = await window.OnlineRecipes.findOnline(o);
      ({ matches, removed, skipped } = found);
      if (!matches.length) notice += "No online recipes matched everything you entered, so these are built-in recipes.";
    } catch (e) {
      notice += "The online recipe database couldn't be reached, so these are built-in recipes.";
    } finally { button.disabled = false; button.textContent = "Find recipes"; }
    if (!matches.length) ({ matches, removed } = C.findRecipes({ ...o, servings: Math.min(o.servings, 12) }));
    const usesBuiltIn = !matches.length || matches[0].recipe.origin !== "online";
    state = { matches, removed, allergens, notice: notice.trim(), active: 0, skipped: usesBuiltIn ? null : skipped, unknown: usesBuiltIn ? C.recognise(usable, C.resolveFood).unknown : [] };
    renderResults();
    if (window.innerWidth <= 860) $("results").scrollIntoView();
  });

  $("alt-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const box = $("alt-results"), item = $("alt-item").value.trim(), kind = $("alt-kind").value;
    const allergens = allergensFromForm();
    box.replaceChildren();
    if (!item) return box.append(el("p", { class: "warn", textContent: "Enter an ingredient or utensil." }));
    if (!allergens.length && !$("no-allergens").checked) return box.append(el("p", { class: "warn", textContent: "Select your allergens, or tick 'I have no allergens to avoid'." }));
    let result = C.builtInAlternatives(item, kind, allergens);
    const fallback = result, key = aiAuth(), button = $("alt-find");
    if (key) {
      button.disabled = true; button.textContent = "Searching...";
      try {
        const found = await C.searchAlternatives(key, item, kind, allergens, checked("diet"));
        if (found.alternatives.length) result = found;
      } catch (e) { /* The built-in list is shown instead. */ }
      button.disabled = false; button.textContent = "Find alternatives";
    }
    if (result.origin === "built-in") box.append(el("p", { class: "notice", textContent: key ? "Online search wasn't available, so these come from the built-in list, not from cookbooks." : "These come from the built-in list, not from cookbooks. Use the search link for cookbook advice." }));
    if (result.origin === "unverified") box.append(el("p", { class: "warn", textContent: "Google Search returned no sources, so these suggestions are unverified." }));
    if (result.removed_for_allergens.length) box.append(el("p", { class: "warn", textContent: `Removed because of your allergens: ${result.removed_for_allergens.join("; ")}` }));
    if (!result.alternatives.length) box.append(el("p", { textContent: `The built-in list has no safe alternative for ${item}.` }));
    result.alternatives.forEach((a) => box.append(el("div", { class: "alt-item" }, el("strong", { textContent: a.name[0].toUpperCase() + a.name.slice(1) }), el("p", { textContent: a.how_to_use }),
      a.ratio_or_adjustment ? el("p", { class: "small", textContent: `Amount or adjustment: ${a.ratio_or_adjustment}` }) : null,
      a.healthier_note ? el("p", { class: "small", textContent: `Health note: ${a.healthier_note}` }) : null,
      a.cookbook_or_site ? el("p", { class: "small", textContent: `Named by the AI from its search: ${a.cookbook_or_site}` }) : null)));
    if (result.sources.length) box.append(el("h3", { textContent: "Sources found by Google Search" }), el("ul", {}, result.sources.map((s) => el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener", textContent: s.title })))));
    box.append(el("p", {}, el("a", { href: fallback.search_url, target: "_blank", rel: "noopener", textContent: `Search online for cookbook advice on ${item}` })));
  });
})();
