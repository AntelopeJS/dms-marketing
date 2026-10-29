/** The demo shop page the heatmap snapshot of the playground shows. */
export const SNAPSHOT_HTML = `<!doctype html><html><head><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#111;background:#fff}
header{display:flex;align-items:center;gap:24px;padding:18px 40px;border-bottom:1px solid #eee}
header b{font-size:18px;margin-right:auto}header nav{display:flex;gap:20px}header nav a{color:#555;text-decoration:none}
header nav a.cart{border:1px solid #ddd;border-radius:8px;padding:4px 10px}
main .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;padding:48px 40px;background:#eefbfc}
.hero h1{font-size:44px;line-height:1.1;margin:8px 0 16px}.hero p{color:#555;max-width:440px}
.eyebrow{font:600 12px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}
.btn-primary,.btn-ghost{display:inline-block;margin-right:10px;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600}
.btn-primary{background:#0e7c86;color:#fff}.btn-ghost{background:#fff;color:#0e7c86;border:1px solid #cde}
picture{display:block;height:300px;border-radius:16px;background:linear-gradient(135deg,#a5f3fc,#cffafe)}
.products{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px 40px;list-style:none;margin:0}
.products li{border:1px solid #eee;border-radius:12px;padding:16px}.products .img{height:140px;background:#f0fbfc;border-radius:8px;margin-bottom:12px}
.products button{width:100%;padding:10px;border:0;border-radius:8px;background:#111;color:#fff;font-weight:600}
.quote{display:flex;align-items:center;gap:16px;margin:24px 40px 48px;padding:24px;border-radius:12px;background:#f6f6f6}
.quote div{margin-right:auto}.quote button{padding:12px 20px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:600}
</style></head><body>
<header><b>acme</b><nav><a href="#">Desks</a><a href="#">Chairs</a><a href="#">Accessories</a><a href="#">B2B pricing</a><a class="cart" href="#">Cart · 2</a></nav></header>
<main><section class="hero"><div><p class="eyebrow">Autumn sale · until Oct 6</p><h1>Ergonomic chairs, up to 30% off</h1>
<p>Fit out the whole team. Volume pricing from 10 seats, free delivery across the EU, 5-year warranty.</p>
<a class="btn-primary" href="#">Shop the sale</a><a class="btn-ghost" href="#">Compare chairs</a></div><picture></picture></section>
<h2 style="padding:0 40px;margin:32px 0 0">Best sellers</h2>
<ul class="products"><li><div class="img"></div><b>Ergo chair · Graphite</b><p>€272</p><button>Add to cart</button></li>
<li><div class="img"></div><b>Task chair · Sand</b><p>€189</p><button>Add to cart</button></li>
<li><div class="img"></div><b>Mesh chair · Black</b><p>€239</p><button>Add to cart</button></li></ul>
<section class="quote"><div><b>Buying for 10+ seats?</b><br>Get a quote within one business day.</div><button>Request a quote</button></section></main>
</body></html>`;
