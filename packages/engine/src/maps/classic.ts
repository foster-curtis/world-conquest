// Classic map: the source of truth for territory IDs, continents, adjacency and card symbols (SPEC §5.2).
// Published maps are immutable: event logs reference these IDs forever. Any change means a new map ID.
// 42 territories, 6 continents, 83 borders. Card symbols cycle infantry → cavalry → artillery in table order.
// alaska ↔ kamchatka wraps around the map edge.
import type { MapDefinition } from '../types.ts';

export const classicMap: MapDefinition = {
  id: 'classic',
  name: 'Classic',
  territories: {
    // North America
    alaska: {
      name: 'Alaska',
      continent: 'north_america',
      cardSymbol: 'infantry',
      adjacent: ['northwest_territory', 'alberta', 'kamchatka'],
    },
    northwest_territory: {
      name: 'Northwest Territory',
      continent: 'north_america',
      cardSymbol: 'cavalry',
      adjacent: ['alaska', 'alberta', 'ontario', 'greenland'],
    },
    greenland: {
      name: 'Greenland',
      continent: 'north_america',
      cardSymbol: 'artillery',
      adjacent: ['northwest_territory', 'ontario', 'quebec', 'iceland'],
    },
    alberta: {
      name: 'Alberta',
      continent: 'north_america',
      cardSymbol: 'infantry',
      adjacent: ['alaska', 'northwest_territory', 'ontario', 'western_us'],
    },
    ontario: {
      name: 'Ontario',
      continent: 'north_america',
      cardSymbol: 'cavalry',
      adjacent: ['northwest_territory', 'greenland', 'alberta', 'quebec', 'western_us', 'eastern_us'],
    },
    quebec: {
      name: 'Quebec',
      continent: 'north_america',
      cardSymbol: 'artillery',
      adjacent: ['greenland', 'ontario', 'eastern_us'],
    },
    western_us: {
      name: 'Western United States',
      continent: 'north_america',
      cardSymbol: 'infantry',
      adjacent: ['alberta', 'ontario', 'eastern_us', 'central_america'],
    },
    eastern_us: {
      name: 'Eastern United States',
      continent: 'north_america',
      cardSymbol: 'cavalry',
      adjacent: ['ontario', 'quebec', 'western_us', 'central_america'],
    },
    central_america: {
      name: 'Central America',
      continent: 'north_america',
      cardSymbol: 'artillery',
      adjacent: ['western_us', 'eastern_us', 'venezuela'],
    },
    // South America
    venezuela: {
      name: 'Venezuela',
      continent: 'south_america',
      cardSymbol: 'infantry',
      adjacent: ['central_america', 'peru', 'brazil'],
    },
    peru: {
      name: 'Peru',
      continent: 'south_america',
      cardSymbol: 'cavalry',
      adjacent: ['venezuela', 'brazil', 'argentina'],
    },
    brazil: {
      name: 'Brazil',
      continent: 'south_america',
      cardSymbol: 'artillery',
      adjacent: ['venezuela', 'peru', 'argentina', 'north_africa'],
    },
    argentina: {
      name: 'Argentina',
      continent: 'south_america',
      cardSymbol: 'infantry',
      adjacent: ['peru', 'brazil'],
    },
    // Europe
    iceland: {
      name: 'Iceland',
      continent: 'europe',
      cardSymbol: 'cavalry',
      adjacent: ['greenland', 'great_britain', 'scandinavia'],
    },
    great_britain: {
      name: 'Great Britain',
      continent: 'europe',
      cardSymbol: 'artillery',
      adjacent: ['iceland', 'scandinavia', 'northern_europe', 'western_europe'],
    },
    scandinavia: {
      name: 'Scandinavia',
      continent: 'europe',
      cardSymbol: 'infantry',
      adjacent: ['iceland', 'great_britain', 'northern_europe', 'ukraine'],
    },
    northern_europe: {
      name: 'Northern Europe',
      continent: 'europe',
      cardSymbol: 'cavalry',
      adjacent: ['great_britain', 'scandinavia', 'western_europe', 'southern_europe', 'ukraine'],
    },
    western_europe: {
      name: 'Western Europe',
      continent: 'europe',
      cardSymbol: 'artillery',
      adjacent: ['great_britain', 'northern_europe', 'southern_europe', 'north_africa'],
    },
    southern_europe: {
      name: 'Southern Europe',
      continent: 'europe',
      cardSymbol: 'infantry',
      adjacent: ['northern_europe', 'western_europe', 'ukraine', 'north_africa', 'egypt', 'middle_east'],
    },
    ukraine: {
      name: 'Ukraine',
      continent: 'europe',
      cardSymbol: 'cavalry',
      adjacent: ['scandinavia', 'northern_europe', 'southern_europe', 'ural', 'afghanistan', 'middle_east'],
    },
    // Africa
    north_africa: {
      name: 'North Africa',
      continent: 'africa',
      cardSymbol: 'artillery',
      adjacent: ['brazil', 'western_europe', 'southern_europe', 'egypt', 'east_africa', 'congo'],
    },
    egypt: {
      name: 'Egypt',
      continent: 'africa',
      cardSymbol: 'infantry',
      adjacent: ['southern_europe', 'north_africa', 'east_africa', 'middle_east'],
    },
    east_africa: {
      name: 'East Africa',
      continent: 'africa',
      cardSymbol: 'cavalry',
      adjacent: ['north_africa', 'egypt', 'congo', 'south_africa', 'madagascar', 'middle_east'],
    },
    congo: {
      name: 'Congo',
      continent: 'africa',
      cardSymbol: 'artillery',
      adjacent: ['north_africa', 'east_africa', 'south_africa'],
    },
    south_africa: {
      name: 'South Africa',
      continent: 'africa',
      cardSymbol: 'infantry',
      adjacent: ['east_africa', 'congo', 'madagascar'],
    },
    madagascar: {
      name: 'Madagascar',
      continent: 'africa',
      cardSymbol: 'cavalry',
      adjacent: ['east_africa', 'south_africa'],
    },
    // Asia
    ural: {
      name: 'Ural',
      continent: 'asia',
      cardSymbol: 'artillery',
      adjacent: ['ukraine', 'siberia', 'china', 'afghanistan'],
    },
    siberia: {
      name: 'Siberia',
      continent: 'asia',
      cardSymbol: 'infantry',
      adjacent: ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
    },
    yakutsk: {
      name: 'Yakutsk',
      continent: 'asia',
      cardSymbol: 'cavalry',
      adjacent: ['siberia', 'kamchatka', 'irkutsk'],
    },
    kamchatka: {
      name: 'Kamchatka',
      continent: 'asia',
      cardSymbol: 'artillery',
      adjacent: ['alaska', 'yakutsk', 'irkutsk', 'mongolia', 'japan'],
    },
    irkutsk: {
      name: 'Irkutsk',
      continent: 'asia',
      cardSymbol: 'infantry',
      adjacent: ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
    },
    mongolia: {
      name: 'Mongolia',
      continent: 'asia',
      cardSymbol: 'cavalry',
      adjacent: ['siberia', 'kamchatka', 'irkutsk', 'japan', 'china'],
    },
    japan: {
      name: 'Japan',
      continent: 'asia',
      cardSymbol: 'artillery',
      adjacent: ['kamchatka', 'mongolia'],
    },
    afghanistan: {
      name: 'Afghanistan',
      continent: 'asia',
      cardSymbol: 'infantry',
      adjacent: ['ukraine', 'ural', 'china', 'india', 'middle_east'],
    },
    china: {
      name: 'China',
      continent: 'asia',
      cardSymbol: 'cavalry',
      adjacent: ['ural', 'siberia', 'mongolia', 'afghanistan', 'india', 'siam'],
    },
    middle_east: {
      name: 'Middle East',
      continent: 'asia',
      cardSymbol: 'artillery',
      adjacent: ['southern_europe', 'ukraine', 'egypt', 'east_africa', 'afghanistan', 'india'],
    },
    india: {
      name: 'India',
      continent: 'asia',
      cardSymbol: 'infantry',
      adjacent: ['afghanistan', 'china', 'middle_east', 'siam'],
    },
    siam: {
      name: 'Siam',
      continent: 'asia',
      cardSymbol: 'cavalry',
      adjacent: ['china', 'india', 'indonesia'],
    },
    // Australia
    indonesia: {
      name: 'Indonesia',
      continent: 'australia',
      cardSymbol: 'artillery',
      adjacent: ['siam', 'new_guinea', 'western_australia'],
    },
    new_guinea: {
      name: 'New Guinea',
      continent: 'australia',
      cardSymbol: 'infantry',
      adjacent: ['indonesia', 'western_australia', 'eastern_australia'],
    },
    western_australia: {
      name: 'Western Australia',
      continent: 'australia',
      cardSymbol: 'cavalry',
      adjacent: ['indonesia', 'new_guinea', 'eastern_australia'],
    },
    eastern_australia: {
      name: 'Eastern Australia',
      continent: 'australia',
      cardSymbol: 'artillery',
      adjacent: ['new_guinea', 'western_australia'],
    },
  },
  continents: {
    north_america: { name: 'North America', bonus: 5 },
    south_america: { name: 'South America', bonus: 2 },
    europe: { name: 'Europe', bonus: 5 },
    africa: { name: 'Africa', bonus: 3 },
    asia: { name: 'Asia', bonus: 7 },
    australia: { name: 'Australia', bonus: 2 },
  },
  startingArmies: { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 },
};
