import { executeWebSearch } from "./src/services/webFragranceSearch";

async function run() {
  const perfumes = [
    "Electric Purple Lalique Fragrantica",
    "Dior Sauvage Fragrantica",
    "YSL Libre Fragrantica",
    "Armani Acqua di Gio Fragrantica",
    "Lancome La Vie Est Belle Fragrantica",
  ];

  for (const p of perfumes) {
    const res = await executeWebSearch(p);
    console.log(`\n============================\nQuery: ${p}\nResults: ${res.length}`);
    const frag = res.filter(r => r.url.includes("fragrantica"));
    console.log(`Fragrantica results: ${frag.length}`);
    frag.forEach(f => {
      console.log(`- Title: ${f.title}`);
      console.log(`  URL: ${f.url}`);
      console.log(`  Snippet: ${f.snippet.substring(0, 150)}...`);
    });
    // Wait 1.5 seconds between queries to prevent DDG rate limit
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

run();
