// Made-up recipients for the shipping labels: a common Dutch surname with
// random initials, at a real street in the parcel's city (the street is a real
// one in that municipality, but not necessarily in that exact postcode area),
// a house number, and the postcode with its two letters. Seeded by the parcel
// number, so a parcel always shows the same label.
import { Rng } from './rng';

/** The most common Dutch surnames (after the national family name counts), most common first. */
export const SURNAMES = [
  'de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer',
  'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer',
  'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'van der Linden', 'Kok', 'Jacobs', 'de Haan', 'Vermeulen',
  'van den Heuvel', 'van der Veen', 'van den Broek', 'de Bruijn', 'de Bruin', 'van der Heijden', 'Schouten', 'van Beek', 'Willems', 'van Vliet',
  'van de Ven', 'Hoekstra', 'Maas', 'Verhoeven', 'Koster', 'van Dam', 'van der Wal', 'Prins', 'Blom', 'Huisman',
  'Peeters', 'de Jonge', 'Kuipers', 'van Veen', 'Post', 'Kuiper', 'Veenstra', 'Kramer', 'van den Brink', 'Scholten',
  'van Wijk', 'Postma', 'Martens', 'Vink', 'de Ruiter', 'Timmermans', 'Groen', 'Gerritsen', 'Jonker', 'van Loon',
  'Boer', 'van der Velde', 'Willemsen', 'Smeets', 'de Lange', 'de Vos', 'Bosch', 'van Dongen', 'Schipper', 'de Koning',
  'van der Laan', 'Koning', 'van der Velden', 'Driessen', 'van Doorn', 'Hermans', 'Evers', 'van den Bosch', 'van der Meulen', 'Hofman',
  'Bosman', 'Wolters', 'Sanders', 'van der Horst', 'Mol', 'Kuijpers', 'Molenaar', 'van de Pol', 'de Leeuw', 'Verbeek',
];

/** Real streets in each destination (by the city names in postcodes.ts). */
const STREETS: Record<string, string[]> = {
  Amsterdam: ['Damrak', 'Kalverstraat', 'Prinsengracht', 'Keizersgracht', 'Overtoom', 'Ferdinand Bolstraat', 'Javastraat', 'Van Woustraat'],
  Rotterdam: ['Coolsingel', 'Witte de Withstraat', 'Nieuwe Binnenweg', 'Meent', 'Beijerlandselaan', 'Zwart Janstraat', 'Kralingse Plaslaan'],
  'Den Haag': ['Lange Voorhout', 'Frederik Hendriklaan', 'Laan van Meerdervoort', 'Prinsegracht', 'Weimarstraat', 'Thorbeckelaan'],
  Utrecht: ['Oudegracht', 'Biltstraat', 'Twijnstraat', 'Amsterdamsestraatweg', 'Nobelstraat', 'Kanaalstraat'],
  Eindhoven: ['Stratumseind', 'Kruisstraat', 'Woenselse Markt', 'Boschdijk', 'Aalsterweg', 'Hoogstraat'],
  Groningen: ['Oude Ebbingestraat', 'Herestraat', 'Nieuwe Ebbingestraat', 'Zuiderdiep', 'Korreweg', 'Paterswoldseweg'],
  Tilburg: ['Heuvelstraat', 'Piusstraat', 'Ringbaan-Oost', 'Korvelseweg', 'Goirkestraat', 'Bredaseweg'],
  Almere: ['Grote Markt', 'Stedenwijk', 'Hollandstraat', 'Kruidenwijk', 'Bergsmapad', 'Contrabasweg'],
  Breda: ['Ginnekenweg', 'Haagweg', 'Boschstraat', 'Ceresstraat', 'Baronielaan', 'Haven'],
  Nijmegen: ['Groesbeekseweg', 'Daalseweg', 'Hertogstraat', 'Graafseweg', 'Sint Annastraat', 'Molenstraat'],
  Apeldoorn: ['Hoofdstraat', 'Deventerstraat', 'Loolaan', 'Asselsestraat', 'Zwolseweg', 'Koninginnelaan'],
  Arnhem: ['Rijnkade', 'Steenstraat', 'Velperweg', 'Amsterdamseweg', 'Jansbinnensingel', 'Klarendalseweg'],
  Haarlemmermeer: ['Kruisweg', 'Hoofdweg', 'Burgemeester van Stamplein', 'Bennebroekerweg', 'Spoorlaan', 'Graan voor Visch'],
  Haarlem: ['Grote Houtstraat', 'Zijlweg', 'Kleverparkweg', 'Rijksstraatweg', 'Gedempte Oude Gracht', 'Schoterweg'],
  Enschede: ['Oldenzaalsestraat', 'Hengelosestraat', 'Haaksbergerstraat', 'Gronausestraat', 'Deurningerstraat', 'Kuipersdijk'],
  Amersfoort: ['Langestraat', 'Arnhemseweg', 'Utrechtseweg', 'Kamp', 'Leusderweg', 'Soesterweg'],
  Zaanstad: ['Gedempte Gracht', 'Westzijde', 'Oostzijde', 'Peperstraat', 'Vincent van Goghweg', 'Provincialeweg'],
  "'s-Hertogenbosch": ['Hinthamerstraat', 'Vughterstraat', 'Orthenseweg', 'Brugstraat', 'Graafseweg', 'Pettelaarseweg'],
  Zwolle: ['Diezerstraat', 'Assendorperstraat', 'Thomas a Kempisstraat', 'Wipstrikkerallee', 'Middelweg', 'Rieteweg'],
  Leiden: ['Breestraat', 'Haarlemmerstraat', 'Rapenburg', 'Hooigracht', 'Morsweg', 'Hoge Rijndijk'],
  Zoetermeer: ['Dorpsstraat', 'Meerzichtlaan', 'Amerikaweg', 'Europaweg', 'Bredewater', 'Boerhaavelaan'],
  Leeuwarden: ['Nieuwestad', 'Voorstreek', 'Tweebaksmarkt', 'Harlingerstraatweg', 'Valeriusstraat', 'Spanjaardslaan'],
  Maastricht: ['Rechtstraat', 'Wycker Brugstraat', 'Brusselsestraat', 'Tongerseweg', 'Akersteenweg', 'Meerssenerweg'],
  Ede: ['Grotestraat', 'Molenstraat', 'Stationsweg', 'Klinkenbergerweg', 'Bennekomseweg', 'Verlengde Maanderweg'],
  Dordrecht: ['Voorstraat', 'Wijnstraat', 'Burgemeester de Raadtsingel', 'Krispijnseweg', 'Dubbeldamseweg', 'Vrieseweg'],
  'Alphen a/d Rijn': ['Hooftstraat', 'Prins Bernhardlaan', 'Raadhuisstraat', 'Ridderveld', 'Hoorn', 'Van Boetzelaerstraat'],
  Westland: ['Herenstraat', 'Molenweg', 'Naaldwijkseweg', 'Laan van Wateringse Veld', 'Dorpskade', 'Sint Annastraat'],
  Alkmaar: ['Langestraat', 'Laat', 'Kennemerstraatweg', 'Bergerweg', 'Nassaulaan', 'Oudegracht'],
  Emmen: ['Hoofdstraat', 'Weerdingerstraat', 'Statenweg', 'Noordbargerstraat', 'Boslaan', 'Angelsloërdijk'],
  Delft: ['Oude Delft', 'Choorstraat', 'Westvest', 'Phoenixstraat', 'Papsouwselaan', 'Brasserskade'],
  Venlo: ['Lomstraat', 'Parade', 'Kaldenkerkerweg', 'Eindhovenseweg', 'Tegelseweg', 'Straelseweg'],
  Deventer: ['Brink', 'Lange Bisschopstraat', 'Brinkgreverweg', 'Zutphenseweg', 'Snipperlingsdijk', 'Rielerweg'],
  'Sittard-Geleen': ['Rosmolenstraat', 'Markt', 'Rijksweg Zuid', 'Leyenbroekerweg', 'Annastraat', 'Mauritslaan'],
  Helmond: ['Veestraat', 'Kerkstraat', 'Mierloseweg', 'Kanaaldijk', 'Brandevoortse Dreef', 'Europaweg'],
  Oss: ['Heuvel', 'Molenstraat', 'Kruisstraat', 'Berghemseweg', 'Kantsingel', 'Oijenseweg'],
  Amstelveen: ['Stadsplein', 'Amsterdamseweg', 'Van der Hooplaan', 'Keizer Karelweg', 'Bovenkerkerweg', 'Laan Nieuwer-Amstel'],
  Hilversum: ['Kerkstraat', 'Groest', 'Larenseweg', "'s-Gravelandseweg", 'Soestdijkerstraatweg', 'Vaartweg'],
  'Súdwest-Fryslân': ['Nieuwmarkt', 'Grootzand', 'Leeuwarderweg', 'Hemdijk', 'Oosterdijk', 'Westersingel'],
  Heerlen: ['Saroleastraat', 'Akerstraat', 'Geleenstraat', 'Kloosterweg', 'Ganzeweide', 'Valkenburgerweg'],
  Nissewaard: ['Spijkenisserbrug', 'Uitstraat', 'Hekelingseweg', 'Groene Kruisweg', 'Noordweg', 'Jan Campertstraat'],
};

/** Postcode letters: some pairs are not used (SA, SD, SS); and no F, I, O, Q, U, Y. */
const LETTERS = 'ABCDEGHJKLMNPRSTVWXZ';

export interface Address {
  name: string;
  street: string;
  number: string;
  postcode: string;
  city: string;
}

export function addressFor(id: number, pc: number, city: string): Address {
  const r = new Rng((id * 2654435761) >>> 0);
  const pick = <T>(a: T[]): T => a[Math.floor(r.next() * a.length)]!;
  // Initials: one to three, mostly one or two.
  const n = r.next() < 0.45 ? 1 : r.next() < 0.85 ? 2 : 3;
  let initials = '';
  for (let i = 0; i < n; i++) initials += 'ABCDEFGHIJKLMNPRSTW'[Math.floor(r.next() * 19)]! + '.';
  // Surnames weighted towards the common ones.
  const surname = SURNAMES[Math.floor(r.next() ** 1.6 * SURNAMES.length)]!;
  // (After initials the prefix stays lower case: J. van Dijk.)
  const name = `${initials} ${surname}`;
  const street = pick(STREETS[city] ?? ['Dorpsstraat', 'Kerkstraat', 'Molenweg']);
  let number = String(1 + Math.floor(r.next() ** 1.8 * 240));
  if (r.next() < 0.18) number += pick(['A', 'B', '-1', '-2', ' bis']);
  let letters = '';
  do letters = pick([...LETTERS]) + pick([...LETTERS]);
  while (['SA', 'SD', 'SS'].includes(letters));
  return { name, street, number, postcode: `${pc} ${letters}`, city };
}
