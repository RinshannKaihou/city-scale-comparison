import fs from 'fs';

const data = JSON.parse(fs.readFileSync('public/data/cities.json', 'utf8'));

for (const city of data) {
  const roads = city.roads || [];
  fs.writeFileSync(
    `public/data/roads/${city.id}.json`,
    JSON.stringify(roads)
  );
  delete city.roads;
  console.log(`Extracted ${city.id}: ${roads.length} segments`);
}

fs.writeFileSync('public/data/cities.json', JSON.stringify(data, null, 2));
console.log('\nDone! cities.json size:', (fs.readFileSync('public/data/cities.json').length / 1024).toFixed(1), 'KB');
