/**
 * genreGraph — a hand-curated genre adjacency graph.
 *
 * Nodes are either FAMILIES (Deezer's top-level genres, e.g. "Rock") or STYLES
 * (sub-genres, e.g. "Shoegaze"). Every style is linked to its family. Extra
 * edges link styles/families that share something a listener can hear: an era,
 * a mood, instrumentation, a language, or shared artists. Each edge carries a
 * short human sentence used for the "Why this?" line in Blind Spot.
 *
 * Each style lists a few ENTRY-POINT artists: accessible, melodic, popular
 * names, never extreme deep cuts. Blind Spot uses their top tracks to open a
 * door into a far genre.
 *
 * Tune it freely: add nodes, edges or artists below. Everything else adapts.
 */

import { PLANETS, MOONS } from './genreData.js';

/** Deezer genre id -> family node. Names must match Deezer's genre names. */
export const FAMILIES = [
  { id: 'pop', name: 'Pop', deezerId: 132 },
  { id: 'hip-hop', name: 'Rap/Hip Hop', deezerId: 116 },
  { id: 'rock', name: 'Rock', deezerId: 152 },
  { id: 'dance', name: 'Dance', deezerId: 113 },
  { id: 'rnb', name: 'R&B', deezerId: 165 },
  { id: 'alternative', name: 'Alternative', deezerId: 85 },
  { id: 'electro', name: 'Electro', deezerId: 106 },
  { id: 'folk', name: 'Folk', deezerId: 466 },
  { id: 'reggae', name: 'Reggae', deezerId: 144 },
  { id: 'jazz', name: 'Jazz', deezerId: 129 },
  { id: 'country', name: 'Country', deezerId: 84 },
  { id: 'chanson', name: 'French Chanson', deezerId: 52 },
  { id: 'classical', name: 'Classical', deezerId: 98 },
  { id: 'films-games', name: 'Films/Games', deezerId: 173 },
  { id: 'metal', name: 'Metal', deezerId: 464 },
  { id: 'soul-funk', name: 'Soul & Funk', deezerId: 169 },
  { id: 'african', name: 'African Music', deezerId: 2 },
  { id: 'arabic', name: 'Arabic Music', deezerId: 12 },
  { id: 'asian', name: 'Asian Music', deezerId: 16 },
  { id: 'blues', name: 'Blues', deezerId: 153 },
  { id: 'brazilian', name: 'Brazilian Music', deezerId: 75 },
  { id: 'indian', name: 'Indian Music', deezerId: 81 },
  { id: 'latin', name: 'Latin Music', deezerId: 197 },
  { id: 'kids', name: 'Kids', deezerId: 95, noExplore: true },
];

/**
 * Styles: [id, name, familyId, entry artists, extra MusicBrainz tags]
 * The style's own lowercase name is always matched as a tag too.
 */
const STYLES = [
  // Pop
  ['synth-pop', 'Synth-pop', 'pop', ['Pet Shop Boys', 'CHVRCHES', 'Erasure'], ['synthpop', 'electropop']],
  ['dance-pop', 'Dance-pop', 'pop', ['Dua Lipa', 'Kylie Minogue', 'Lady Gaga'], []],
  ['indie-pop', 'Indie pop', 'pop', ['Phoenix', 'Vampire Weekend', 'Two Door Cinema Club'], ['indie-pop']],
  ['art-pop', 'Art pop', 'pop', ['Björk', 'Kate Bush', 'Florence + The Machine'], ['art-pop', 'baroque pop']],
  ['60s-pop', 'Beat music', 'pop', ['The Beatles', 'The Kinks', 'The Hollies'], ['merseybeat', 'beat', 'british invasion']],
  // Rap / Hip Hop
  ['boom-bap', 'Boom bap', 'hip-hop', ['Nas', 'A Tribe Called Quest', 'Wu-Tang Clan'], ['east coast hip hop', 'golden age hip hop']],
  ['trap', 'Trap', 'hip-hop', ['Travis Scott', 'Future', 'Migos'], ['trap rap']],
  ['conscious-hip-hop', 'Conscious hip hop', 'hip-hop', ['Kendrick Lamar', 'Common', 'Mos Def'], ['political hip hop']],
  ['french-rap', 'French rap', 'hip-hop', ['IAM', 'MC Solaar', 'Orelsan'], ['french hip hop', 'rap français']],
  ['jazz-rap', 'Jazz rap', 'hip-hop', ['Digable Planets', 'Guru', 'The Pharcyde'], ['jazz hip hop']],
  ['lofi-hip-hop', 'Lo-fi hip hop', 'hip-hop', ['Nujabes', 'J Dilla', 'Tomppabeats'], ['lo-fi', 'chillhop', 'instrumental hip hop']],
  ['drill', 'Drill', 'hip-hop', ['Pop Smoke', 'Central Cee', 'Headie One'], ['uk drill']],
  ['alt-hip-hop', 'Alternative hip hop', 'hip-hop', ['OutKast', 'Gorillaz', 'Tyler, The Creator'], ['alternative hip hop', 'experimental hip hop']],
  // Rock
  ['glam-rock', 'Glam rock', 'rock', ['David Bowie', 'T. Rex', 'Queen'], ['glam']],
  ['hard-rock', 'Hard rock', 'rock', ['AC/DC', "Guns N' Roses", 'Aerosmith'], []],
  ['psychedelic-rock', 'Psychedelic rock', 'rock', ['Pink Floyd', 'The Doors', 'Tame Impala'], ['psychedelic', 'neo-psychedelia']],
  ['punk', 'Punk rock', 'rock', ['The Clash', 'Ramones', 'Green Day'], ['punk', 'pop punk']],
  ['garage-revival', 'Garage rock', 'rock', ['The Strokes', 'The White Stripes', 'The Hives'], ['garage rock revival', 'garage rock']],
  ['prog-rock', 'Progressive rock', 'rock', ['Genesis', 'Yes', 'Supertramp'], ['prog rock', 'progressive']],
  ['britpop', 'Britpop', 'rock', ['Oasis', 'Blur', 'Pulp'], []],
  ['blues-rock', 'Blues rock', 'rock', ['The Black Keys', 'Cream', 'Jimi Hendrix'], []],
  ['rockabilly', 'Rock and roll', 'rock', ['Elvis Presley', 'Chuck Berry', 'Stray Cats'], ['rock and roll', "rock 'n' roll", 'rockabilly']],
  // Alternative
  ['indie-rock', 'Indie rock', 'alternative', ['Arctic Monkeys', 'The Killers', 'Franz Ferdinand'], ['indie']],
  ['shoegaze', 'Shoegaze', 'alternative', ['Slowdive', 'My Bloody Valentine', 'Ride'], []],
  ['dream-pop', 'Dream pop', 'alternative', ['Beach House', 'Cigarettes After Sex', 'Cocteau Twins'], ['ethereal']],
  ['post-punk', 'Post-punk', 'alternative', ['The Cure', 'Joy Division', 'Interpol'], ['post-punk revival', 'gothic rock']],
  ['grunge', 'Grunge', 'alternative', ['Nirvana', 'Pearl Jam', 'Soundgarden'], []],
  ['post-rock', 'Post-rock', 'alternative', ['Explosions in the Sky', 'Sigur Rós', 'Mogwai'], []],
  ['emo', 'Emo', 'alternative', ['My Chemical Romance', 'Jimmy Eat World', 'Paramore'], []],
  ['new-wave', 'New wave', 'alternative', ['Depeche Mode', 'Talking Heads', 'Tears for Fears'], []],
  ['math-rock', 'Math rock', 'alternative', ['toe', 'Covet', 'Chon'], []],
  // Electro
  ['house', 'House', 'electro', ['Disclosure', 'Bob Sinclar', 'Fisher'], ['deep house', 'tech house']],
  ['techno', 'Techno', 'electro', ['Charlotte de Witte', 'Boris Brejcha', 'Paul Kalkbrenner'], ['minimal techno']],
  ['trance', 'Trance', 'electro', ['Armin van Buuren', 'Tiësto', 'Above & Beyond'], ['progressive trance']],
  ['dnb', 'Drum and bass', 'electro', ['Pendulum', 'Netsky', 'Chase & Status'], ['drum & bass', 'liquid funk', 'jungle']],
  ['dubstep', 'Dubstep', 'electro', ['Skrillex', 'Burial', 'Flux Pavilion'], ['brostep']],
  ['ambient', 'Ambient', 'electro', ['Brian Eno', 'Tycho', 'Boards of Canada'], ['ambient electronic', 'chillout']],
  ['trip-hop', 'Trip hop', 'electro', ['Massive Attack', 'Portishead', 'Air'], ['downtempo']],
  ['synthwave', 'Synthwave', 'electro', ['Kavinsky', 'The Midnight', 'Gunship'], ['retrowave', 'outrun']],
  ['french-touch', 'French touch', 'electro', ['Daft Punk', 'Justice', 'Cassius'], ['french house', 'filter house']],
  ['idm', 'Electronica', 'electro', ['Bonobo', 'Four Tet', 'Caribou'], ['idm', 'electronica', 'folktronica']],
  // Dance
  ['eurodance', 'Eurodance', 'dance', ['Haddaway', 'Eiffel 65', 'Corona'], []],
  ['disco', 'Disco', 'dance', ['Bee Gees', 'Donna Summer', 'Chic'], []],
  ['nu-disco', 'Nu-disco', 'dance', ['Purple Disco Machine', 'Parcels', 'Breakbot'], ['disco house']],
  ['edm', 'Progressive house', 'dance', ['Avicii', 'Swedish House Mafia', 'Eric Prydz'], ['electro house', 'big room', 'edm']],
  ['afro-house', 'Afro house', 'dance', ['Black Coffee', 'Keinemusik', 'Culoe De Song'], []],
  // R&B
  ['contemporary-rnb', 'Alternative R&B', 'rnb', ['SZA', 'Frank Ocean', 'The Weeknd'], ['alternative r&b', 'contemporary r&b']],
  ['neo-soul', 'Neo soul', 'rnb', ["D'Angelo", 'Erykah Badu', 'Jill Scott'], ['neo-soul']],
  ['hip-hop-soul', 'Hip hop soul', 'rnb', ['Mary J. Blige', 'Jodeci', 'TLC'], []],
  ['new-jack-swing', 'New jack swing', 'rnb', ['Bobby Brown', 'Bell Biv DeVoe', 'Keith Sweat'], []],
  // Soul & Funk
  ['southern-soul', 'Southern soul', 'soul-funk', ['Otis Redding', 'Al Green', 'Sam & Dave'], ['memphis soul', 'deep soul']],
  ['motown', 'Motown sound', 'soul-funk', ['Stevie Wonder', 'The Supremes', 'The Temptations'], []],
  ['funk', 'Funk', 'soul-funk', ['James Brown', 'Earth, Wind & Fire', 'Parliament'], ['p-funk']],
  ['modern-funk', 'Boogie', 'soul-funk', ['Chromeo', 'Tuxedo', 'Dâm-Funk'], ['electro-funk', 'modern funk']],
  ['gospel', 'Gospel', 'soul-funk', ['Mahalia Jackson', 'Kirk Franklin', 'The Blind Boys of Alabama'], []],
  // Jazz
  ['bebop', 'Bebop', 'jazz', ['Charlie Parker', 'Thelonious Monk', 'Dizzy Gillespie'], ['hard bop']],
  ['cool-jazz', 'Cool jazz', 'jazz', ['Miles Davis', 'Chet Baker', 'Dave Brubeck'], ['modal jazz']],
  ['jazz-fusion', 'Jazz fusion', 'jazz', ['Herbie Hancock', 'Weather Report', 'Snarky Puppy'], ['fusion']],
  ['swing', 'Swing', 'jazz', ['Duke Ellington', 'Count Basie', 'Glenn Miller'], ['big band']],
  ['modern-jazz', 'Nu jazz', 'jazz', ['GoGo Penguin', 'BADBADNOTGOOD', 'St Germain'], ['nu-jazz', 'future jazz']],
  ['acid-jazz', 'Acid jazz', 'jazz', ['Jamiroquai', 'Incognito', 'The Brand New Heavies'], []],
  ['gypsy-jazz', 'Gypsy jazz', 'jazz', ['Django Reinhardt', 'Biréli Lagrène', 'Thomas Dutronc'], ['jazz manouche']],
  // Blues
  ['delta-blues', 'Delta blues', 'blues', ['Robert Johnson', 'Mississippi John Hurt', 'Son House'], ['country blues', 'acoustic blues']],
  ['chicago-blues', 'Chicago blues', 'blues', ['Muddy Waters', "Howlin' Wolf", 'Buddy Guy'], []],
  ['texas-blues', 'Texas blues', 'blues', ['Stevie Ray Vaughan', 'Gary Clark Jr.', 'Freddie King'], []],
  // Folk
  ['indie-folk', 'Indie folk', 'folk', ['Bon Iver', 'Fleet Foxes', 'The Lumineers'], ['folk pop']],
  ['celtic', 'Celtic folk', 'folk', ['Loreena McKennitt', 'Clannad', 'The Chieftains'], ['celtic', 'irish folk']],
  ['folk-rock', 'Folk rock', 'folk', ['Simon & Garfunkel', 'Fleetwood Mac', 'Crosby, Stills, Nash & Young'], []],
  ['americana', 'Americana', 'folk', ['Brandi Carlile', 'Jason Isbell', 'Gregory Alan Isakov'], ['alt-country']],
  // Country
  ['honky-tonk', 'Honky-tonk', 'country', ['Hank Williams', 'George Jones', 'Dwight Yoakam'], ['honky tonk']],
  ['modern-country', 'Country pop', 'country', ['Kacey Musgraves', 'Shania Twain', 'Carrie Underwood'], ['nashville sound']],
  ['bluegrass', 'Bluegrass', 'country', ['Alison Krauss', 'Billy Strings', 'Nickel Creek'], []],
  ['outlaw-country', 'Outlaw country', 'country', ['Waylon Jennings', 'Merle Haggard', 'Sturgill Simpson'], []],
  // Reggae
  ['roots-reggae', 'Roots reggae', 'reggae', ['Bob Marley & The Wailers', 'Peter Tosh', 'Burning Spear'], ['roots']],
  ['dub', 'Dub', 'reggae', ['Lee "Scratch" Perry', 'King Tubby', 'Augustus Pablo'], []],
  ['dancehall', 'Dancehall', 'reggae', ['Sean Paul', 'Shaggy', 'Vybz Kartel'], ['ragga']],
  ['ska', 'Ska', 'reggae', ['The Specials', 'Madness', 'Desmond Dekker'], ['2 tone', 'rocksteady']],
  // Latin
  ['reggaeton', 'Reggaeton', 'latin', ['Bad Bunny', 'Daddy Yankee', 'J Balvin'], ['reggaetón', 'urbano latino']],
  ['salsa', 'Salsa', 'latin', ['Celia Cruz', 'Héctor Lavoe', 'Marc Anthony'], []],
  ['cumbia', 'Cumbia', 'latin', ['Los Ángeles Azules', 'Bomba Estéreo', 'Celso Piña'], []],
  ['latin-pop', 'Latin pop', 'latin', ['Shakira', 'Juanes', 'Rosalía'], []],
  ['bachata', 'Bachata', 'latin', ['Romeo Santos', 'Aventura', 'Prince Royce'], []],
  ['tango', 'Tango', 'latin', ['Astor Piazzolla', 'Gotan Project', 'Carlos Gardel'], ['nuevo tango']],
  ['flamenco', 'Flamenco', 'latin', ['Paco de Lucía', 'Gipsy Kings', 'Camarón de la Isla'], ['rumba flamenca']],
  // Brazilian
  ['bossa-nova', 'Bossa nova', 'brazilian', ['Antônio Carlos Jobim', 'João Gilberto', 'Astrud Gilberto'], []],
  ['samba', 'Samba', 'brazilian', ['Jorge Ben Jor', 'Seu Jorge', 'Cartola'], []],
  ['mpb', 'MPB', 'brazilian', ['Caetano Veloso', 'Gilberto Gil', 'Elis Regina'], ['música popular brasileira', 'tropicália', 'tropicalia']],
  // African
  ['afrobeat', 'Afrobeat', 'african', ['Fela Kuti', 'Tony Allen', 'Ebo Taylor'], []],
  ['afrobeats', 'Afrobeats', 'african', ['Burna Boy', 'Wizkid', 'Tems'], ['afropop', 'afro-pop']],
  ['amapiano', 'Amapiano', 'african', ['Kabza De Small', 'Tyla', 'Uncle Waffles'], []],
  ['desert-blues', 'Desert blues', 'african', ['Tinariwen', 'Ali Farka Touré', 'Bombino'], ['tuareg']],
  ['mande', 'Mandé pop', 'african', ['Salif Keita', 'Amadou & Mariam', 'Fatoumata Diawara'], ['malian']],
  ['congolese-rumba', 'Congolese rumba', 'african', ['Papa Wemba', 'Koffi Olomide', 'Fally Ipupa'], ['soukous']],
  // Arabic
  ['rai', 'Raï', 'arabic', ['Khaled', 'Cheb Mami', 'Rachid Taha'], ['rai']],
  ['arabic-pop', 'Arabic pop', 'arabic', ['Amr Diab', 'Nancy Ajram', 'Elissa'], []],
  ['tarab', 'Tarab', 'arabic', ['Fairuz', 'Umm Kulthum', 'Abdel Halim Hafez'], ['tarab']],
  // Asian
  ['k-pop', 'K-pop', 'asian', ['BTS', 'BLACKPINK', 'NewJeans'], ['kpop']],
  ['j-pop', 'J-pop', 'asian', ['YOASOBI', 'Hikaru Utada', 'Kenshi Yonezu'], ['jpop']],
  ['city-pop', 'City pop', 'asian', ['Mariya Takeuchi', 'Tatsuro Yamashita', 'Anri'], []],
  ['j-rock', 'J-rock', 'asian', ['RADWIMPS', 'ONE OK ROCK', "L'Arc~en~Ciel"], ['japanese rock']],
  ['mandopop', 'Mandopop', 'asian', ['Jay Chou', 'Faye Wong', 'G.E.M.'], ['c-pop', 'cantopop']],
  // Indian
  ['bollywood', 'Filmi', 'indian', ['A. R. Rahman', 'Arijit Singh', 'Shreya Ghoshal'], ['bollywood']],
  ['indian-classical', 'Indian classical', 'indian', ['Ravi Shankar', 'Anoushka Shankar', 'Zakir Hussain'], ['hindustani classical', 'carnatic']],
  ['bhangra', 'Bhangra', 'indian', ['Panjabi MC', 'Daler Mehndi', 'Diljit Dosanjh'], []],
  // Classical
  ['baroque', 'Baroque', 'classical', ['Johann Sebastian Bach', 'Antonio Vivaldi', 'Handel'], []],
  ['romantic', 'Romanticism', 'classical', ['Frédéric Chopin', 'Claude Debussy', 'Pyotr Ilyich Tchaikovsky'], ['romantic', 'impressionism']],
  ['minimalism', 'Minimalism', 'classical', ['Philip Glass', 'Steve Reich', 'Arvo Pärt'], ['minimalist', 'contemporary classical']],
  ['neoclassical', 'Neoclassical', 'classical', ['Ludovico Einaudi', 'Max Richter', 'Ólafur Arnalds'], ['modern classical', 'neo-classical']],
  ['opera', 'Opera', 'classical', ['Luciano Pavarotti', 'Maria Callas', 'Andrea Bocelli'], []],
  // Films/Games
  ['film-scores', 'Orchestral score', 'films-games', ['Hans Zimmer', 'John Williams', 'Ennio Morricone'], ['film score', 'orchestral', 'score']],
  ['chiptune', 'Chiptune', 'films-games', ['Anamanaguchi', 'Chipzel', 'Disasterpeace'], ['8-bit', 'bitpop']],
  // Metal
  ['heavy-metal', 'Heavy metal', 'metal', ['Iron Maiden', 'Black Sabbath', 'Judas Priest'], ['nwobhm']],
  ['thrash', 'Thrash metal', 'metal', ['Metallica', 'Megadeth', 'Anthrax'], ['thrash']],
  ['nu-metal', 'Nu metal', 'metal', ['Linkin Park', 'System of a Down', 'Deftones'], ['alternative metal', 'nu-metal']],
  ['metalcore', 'Metalcore', 'metal', ['Bring Me the Horizon', 'Architects', 'Parkway Drive'], []],
  ['symphonic-metal', 'Symphonic metal', 'metal', ['Nightwish', 'Within Temptation', 'Epica'], []],
  ['stoner', 'Stoner rock', 'metal', ['Queens of the Stone Age', 'Kyuss', 'Graveyard'], ['stoner metal', 'desert rock', 'doom metal']],
  ['prog-metal', 'Progressive metal', 'metal', ['Tool', 'Gojira', 'Dream Theater'], []],
  ['blackgaze', 'Blackgaze', 'metal', ['Alcest', 'Deafheaven', 'Les Discrets'], ['post-black metal']],
  // French Chanson
  ['chanson-classique', 'Chanson à texte', 'chanson', ['Jacques Brel', 'Georges Brassens', 'Barbara'], ['chanson réaliste']],
  ['ye-ye', 'Yé-yé', 'chanson', ['Françoise Hardy', 'France Gall', 'Sylvie Vartan'], []],
  ['variete', 'Variété française', 'chanson', ['Jean-Jacques Goldman', 'Daniel Balavoine', 'Michel Berger'], ['variété française']],
];

/**
 * Bridges: [a, b, bridge type, why]. Types: era | mood | instrumentation | language | artists | roots.
 * `why` is written to read well after "…".
 */
const EDGES = [
  // Family-level neighbors
  ['rock', 'alternative', 'instrumentation', 'same guitars, more independent spirit'],
  ['rock', 'metal', 'instrumentation', 'rock with the volume turned up'],
  ['rock', 'blues', 'roots', 'the blues is where rock was born'],
  ['rock', 'pop', 'mood', 'big choruses and catchy hooks'],
  ['pop', 'dance', 'mood', 'made for moving'],
  ['pop', 'rnb', 'mood', 'smooth vocals and catchy melodies'],
  ['pop', 'electro', 'instrumentation', 'synths front and center'],
  ['pop', 'chanson', 'language', 'pop sung in French'],
  ['hip-hop', 'rnb', 'artists', 'artists cross over all the time'],
  ['hip-hop', 'soul-funk', 'roots', 'hip hop grew from soul and funk samples'],
  ['rnb', 'soul-funk', 'roots', 'R&B is soul’s direct descendant'],
  ['soul-funk', 'jazz', 'instrumentation', 'horns, grooves and improvisation'],
  ['soul-funk', 'blues', 'roots', 'both come from gospel and the blues'],
  ['soul-funk', 'dance', 'era', 'funk grooves turned into disco'],
  ['jazz', 'blues', 'roots', 'jazz and blues grew up together'],
  ['jazz', 'brazilian', 'instrumentation', 'jazz harmony with Brazilian rhythm'],
  ['electro', 'dance', 'mood', 'club energy'],
  ['electro', 'alternative', 'mood', 'experimental and moody'],
  ['folk', 'country', 'roots', 'acoustic storytelling'],
  ['folk', 'rock', 'era', 'folk went electric in the sixties'],
  ['country', 'blues', 'roots', 'both born in the American South'],
  ['reggae', 'hip-hop', 'roots', 'sound-system culture is shared'],
  ['reggae', 'latin', 'roots', 'Caribbean rhythms'],
  ['latin', 'brazilian', 'mood', 'warm, rhythmic and sunny'],
  ['latin', 'dance', 'mood', 'made for dancing'],
  ['african', 'soul-funk', 'roots', 'African grooves and funk speak the same language'],
  ['african', 'arabic', 'roots', 'North and West African traditions meet'],
  ['african', 'brazilian', 'roots', 'Brazil’s rhythms came from Africa'],
  ['arabic', 'chanson', 'language', 'raï and chanson both live in France'],
  ['asian', 'pop', 'mood', 'polished, catchy pop'],
  ['indian', 'pop', 'mood', 'big melodies and dance beats'],
  ['classical', 'films-games', 'instrumentation', 'orchestral and cinematic'],
  ['classical', 'jazz', 'instrumentation', 'virtuoso playing and rich harmony'],
  ['films-games', 'electro', 'instrumentation', 'synth-driven soundscapes'],
  // Style-level bridges
  ['dream-pop', 'shoegaze', 'mood', 'the same hazy, dreamy guitars'],
  ['dream-pop', 'indie-pop', 'mood', 'soft vocals and gentle melodies'],
  ['shoegaze', 'blackgaze', 'instrumentation', 'the same wall of sound, with more intensity'],
  ['blackgaze', 'post-rock', 'mood', 'slow-building, cathartic crescendos'],
  ['post-rock', 'ambient', 'mood', 'instrumental, spacious and immersive'],
  ['ambient', 'neoclassical', 'mood', 'calm, minimal and atmospheric'],
  ['neoclassical', 'film-scores', 'instrumentation', 'emotional piano and strings'],
  ['neoclassical', 'minimalism', 'instrumentation', 'repetition and gentle piano'],
  ['film-scores', 'chiptune', 'instrumentation', 'both score video games'],
  ['chiptune', 'synthwave', 'era', 'retro 8-bit and 80s synth sounds'],
  ['films-games', 'j-pop', 'language', 'anime themes are J-pop hits'],
  ['trip-hop', 'lofi-hip-hop', 'mood', 'slow beats for late nights'],
  ['trip-hop', 'acid-jazz', 'era', '90s UK grooves'],
  ['trip-hop', 'dream-pop', 'mood', 'dark, dreamy and atmospheric'],
  ['jazz-rap', 'lofi-hip-hop', 'instrumentation', 'jazzy samples and laid-back beats'],
  ['jazz-rap', 'cool-jazz', 'instrumentation', 'built on samples of jazz records'],
  ['lofi-hip-hop', 'modern-jazz', 'instrumentation', 'jazzy chords over a loose beat'],
  ['synthwave', 'synth-pop', 'era', '80s synths and nostalgia'],
  ['synthwave', 'film-scores', 'mood', 'cinematic 80s soundtracks'],
  ['synthwave', 'french-touch', 'artists', 'Kavinsky came from the French touch scene'],
  ['french-touch', 'house', 'roots', 'French filtered house'],
  ['french-touch', 'nu-disco', 'mood', 'disco samples and funky basslines'],
  ['nu-disco', 'disco', 'roots', 'disco reborn for today'],
  ['disco', 'funk', 'roots', 'funk grooves made for the dancefloor'],
  ['funk', 'afrobeat', 'artists', 'Fela Kuti and James Brown inspired each other'],
  ['afrobeat', 'jazz-fusion', 'instrumentation', 'long grooves and brass solos'],
  ['afrobeats', 'dancehall', 'mood', 'bouncy rhythms and sunny vibes'],
  ['afrobeats', 'amapiano', 'era', 'today’s African dance sounds'],
  ['amapiano', 'afro-house', 'roots', 'South African house music'],
  ['afro-house', 'house', 'roots', 'house with African percussion'],
  ['reggaeton', 'dancehall', 'roots', 'reggaeton grew from dancehall'],
  ['latin-pop', 'dance-pop', 'mood', 'bright, catchy and danceable'],
  ['bachata', 'salsa', 'mood', 'romantic Caribbean dance music'],
  ['salsa', 'cumbia', 'mood', 'rhythm-first Latin dance music'],
  ['flamenco', 'gypsy-jazz', 'instrumentation', 'virtuoso acoustic guitar'],
  ['flamenco', 'latin-pop', 'artists', 'Rosalía brought flamenco into pop'],
  ['tango', 'flamenco', 'mood', 'passionate and dramatic'],
  ['gypsy-jazz', 'swing', 'era', 'the swing era in Paris'],
  ['bossa-nova', 'cool-jazz', 'instrumentation', 'soft, jazzy and relaxed'],
  ['bossa-nova', 'mpb', 'roots', 'Brazilian songwriting'],
  ['samba', 'mpb', 'roots', 'Brazilian rhythm and song'],
  ['mpb', 'psychedelic-rock', 'era', 'tropicália mixed Brazil with sixties psychedelia'],
  ['psychedelic-rock', 'prog-rock', 'era', 'sixties experimentation grew into prog'],
  ['prog-rock', 'prog-metal', 'instrumentation', 'long, ambitious songs'],
  ['grunge', 'nu-metal', 'era', 'heavy guitars of the 90s'],
  ['grunge', 'punk', 'roots', 'raw, loud and direct'],
  ['punk', 'post-punk', 'era', 'what came right after punk'],
  ['punk', 'ska', 'artists', '2 Tone bands mixed ska with punk'],
  ['post-punk', 'new-wave', 'era', 'late-70s guitars meet synths'],
  ['new-wave', 'synth-pop', 'instrumentation', '80s synthesizers'],
  ['emo', 'metalcore', 'artists', 'shared bands and emotional intensity'],
  ['emo', 'punk', 'roots', 'fast guitars and heartfelt lyrics'],
  ['britpop', 'indie-rock', 'roots', 'British guitar bands'],
  ['indie-rock', 'garage-revival', 'era', 'the 2000s guitar revival'],
  ['garage-revival', 'blues-rock', 'instrumentation', 'gritty riffs'],
  ['blues-rock', 'texas-blues', 'roots', 'the same bent guitar notes'],
  ['glam-rock', 'hard-rock', 'era', 'big 70s riffs and showmanship'],
  ['glam-rock', 'britpop', 'artists', 'Bowie and T. Rex shaped Britpop'],
  ['hard-rock', 'heavy-metal', 'roots', 'heavy metal grew out of hard rock'],
  ['heavy-metal', 'thrash', 'roots', 'faster and heavier'],
  ['stoner', 'psychedelic-rock', 'mood', 'fuzzy, hypnotic riffs'],
  ['stoner', 'hard-rock', 'instrumentation', 'big fuzzy riffs'],
  ['symphonic-metal', 'opera', 'instrumentation', 'operatic vocals and orchestras'],
  ['folk-rock', 'americana', 'roots', 'American roots songwriting'],
  ['americana', 'modern-country', 'roots', 'country storytelling'],
  ['americana', 'indie-folk', 'mood', 'warm acoustic songs'],
  ['bluegrass', 'celtic', 'roots', 'fiddles from the same tradition'],
  ['folk', 'chanson', 'mood', 'lyrics first, voice and a guitar'],
  ['ye-ye', '60s-pop', 'era', 'sixties pop'],
  ['ye-ye', 'motown', 'era', 'sixties girl-group sound'],
  ['variete', 'synth-pop', 'era', '80s French synth ballads'],
  ['rai', 'arabic-pop', 'language', 'Arabic-language pop'],
  ['rai', 'desert-blues', 'roots', 'North African guitars and grooves'],
  ['desert-blues', 'delta-blues', 'roots', 'the blues’ African roots'],
  ['k-pop', 'dance-pop', 'mood', 'glossy, high-energy pop'],
  ['j-pop', 'city-pop', 'language', 'Japanese pop, old and new'],
  ['city-pop', 'modern-funk', 'instrumentation', 'slick 80s funk grooves'],
  ['city-pop', 'nu-disco', 'mood', 'smooth, groovy and nostalgic'],
  ['j-rock', 'indie-rock', 'instrumentation', 'energetic guitar bands'],
  ['bhangra', 'edm', 'mood', 'high-energy dance beats'],
  ['bollywood', 'arabic-pop', 'mood', 'lush melodies and strings'],
  ['indian-classical', 'psychedelic-rock', 'instrumentation', 'the sitar entered rock in the sixties'],
  ['dub', 'dubstep', 'roots', 'dubstep took its bass from dub'],
  ['dub', 'trip-hop', 'instrumentation', 'deep bass and echo'],
  ['dubstep', 'dnb', 'era', 'UK bass music'],
  ['edm', 'trance', 'mood', 'euphoric drops'],
  ['trance', 'techno', 'mood', 'hypnotic club music'],
  ['techno', 'house', 'roots', 'twin sounds of the club'],
  ['eurodance', 'edm', 'mood', 'big, cheerful dance anthems'],
  ['trap', 'drill', 'roots', 'drill grew from trap'],
  ['trap', 'contemporary-rnb', 'artists', 'shared producers and features'],
  ['boom-bap', 'jazz-rap', 'era', '90s golden age hip hop'],
  ['boom-bap', 'funk', 'instrumentation', 'built on funk breakbeats'],
  ['conscious-hip-hop', 'neo-soul', 'artists', 'the Soulquarians made both'],
  ['alt-hip-hop', 'indie-pop', 'mood', 'playful and genre-bending'],
  ['gospel', 'southern-soul', 'roots', 'soul singers came from gospel choirs'],
  ['southern-soul', 'motown', 'era', 'the two great 60s soul sounds'],
  ['new-jack-swing', 'hip-hop-soul', 'era', 'late 80s and 90s R&B'],
  ['hip-hop-soul', 'boom-bap', 'era', 'R&B singing over 90s hip hop beats'],
  ['honky-tonk', 'outlaw-country', 'roots', 'barroom country with a twang'],
  ['honky-tonk', 'rockabilly', 'era', '1950s twang'],
  ['neo-soul', 'acid-jazz', 'mood', 'warm, jazzy grooves'],
  ['acid-jazz', 'jazz-fusion', 'roots', 'jazz with funk energy'],
  ['modern-jazz', 'jazz-fusion', 'era', 'today’s jazz explorers'],
  ['swing', 'chanson-classique', 'era', 'the golden age of singers'],
  ['idm', 'ambient', 'mood', 'textured, thoughtful electronics'],
  ['idm', 'indie-folk', 'artists', 'folktronica blends both'],
  ['math-rock', 'post-rock', 'instrumentation', 'intricate instrumental guitars'],
  ['contemporary-rnb', 'synth-pop', 'artists', 'The Weeknd’s 80s synths'],
  ['tarab', 'arabic-pop', 'roots', 'the classics behind Arabic pop'],
  ['mande', 'desert-blues', 'roots', 'Malian guitar traditions'],
  ['congolese-rumba', 'salsa', 'roots', 'Cuban rumba went back to Africa'],
];

/**
 * Sub-genre clean-up (V2). Some entries described a role, an era, an instrument or a
 * label rather than a musical style. Saved songs are migrated with these tables:
 *  - RENAMED_STYLES: same music, real style name (same id) → old names still resolve.
 *  - REMOVED_STYLES: not a style; songs lose that tag and are re-sorted from their
 *    artist's tags (into a real sub-genre if one fits, otherwise just their genre).
 */
export const RENAMED_STYLES = {
  '60s pop': 'Beat music',
  'Classic Arabic': 'Tarab',
  Bollywood: 'Filmi',
  'Contemporary R&B': 'Alternative R&B',
  'Modern jazz': 'Nu jazz',
  'Modern funk': 'Boogie',
  'Romantic era': 'Romanticism',
  'Modern country': 'Country pop',
  'Film scores': 'Orchestral score',
  'Classic chanson': 'Chanson à texte',
  EDM: 'Progressive house',
  Motown: 'Motown sound',
};
export const REMOVED_STYLES = {
  // id: [old name, why it isn't a style, replaced by]
  'singer-songwriter': ['Singer-songwriter', 'a role', null],
  'vocal-jazz': ['Vocal jazz', 'an instrument (the voice)', null],
  'nouvelle-scene': ['New French pop', 'a language/era label', null],
  'classic-rock': ['Classic rock', 'an era / radio format', 'glam-rock'],
  '90s-rnb': ['90s R&B', 'an era', 'hip-hop-soul'],
  'classic-country': ['Classic country', 'an era', 'honky-tonk'],
  'classic-soul': ['Classic soul', 'an era', 'southern-soul'],
  'electric-blues': ['Electric blues', 'an instrument', 'texas-blues'],
  'game-anime': ['Game & anime music', 'a medium, not a sound', 'chiptune'],
};
const REMOVED_NAMES = new Set(Object.values(REMOVED_STYLES).map(([name]) => name.toLowerCase()));
export const isRemovedStyleName = (name) => !!name && REMOVED_NAMES.has(String(name).toLowerCase());
/** Current name of a style name saved by an older version (or the name itself). */
export const currentStyleName = (name) => (name && RENAMED_STYLES[name]) || name;

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

export const NODES = new Map(); // id -> node
const adj = new Map(); // id -> [{ to, type, why }]
const byName = new Map(); // lowercase name -> node
const byTag = new Map(); // lowercase tag -> [node]

function addNode(n) {
  NODES.set(n.id, n);
  adj.set(n.id, []);
  byName.set(n.name.toLowerCase(), n);
}
function addEdge(a, b, type, why) {
  if (!NODES.has(a) || !NODES.has(b)) {
    console.warn('genreGraph: unknown node in edge', a, b);
    return;
  }
  adj.get(a).push({ to: b, type, why });
  adj.get(b).push({ to: a, type, why });
}
function addTag(tag, node) {
  const t = tag.toLowerCase();
  if (!byTag.has(t)) byTag.set(t, []);
  byTag.get(t).push(node);
}

for (const f of FAMILIES) {
  addNode({ ...f, kind: 'family', family: f.id, artists: [] });
  addTag(f.name, NODES.get(f.id));
}
for (const [id, name, family, artists, tags] of STYLES) {
  const node = { id, name, kind: 'style', family, artists, tags };
  addNode(node);
  addTag(name, node);
  addTag(id.replace(/-/g, ' '), node);
  tags.forEach((t) => addTag(t, node));
  addEdge(id, family, 'family', `a style of ${NODES.get(family).name}`);
}
for (const [a, b, type, why] of EDGES) addEdge(a, b, type, why);

// More sub-genres (planets) and their variations (moons), generated from MusicBrainz + Wikidata
// by scripts/build-genres.mjs. They have no hand-picked artists: Swipe Sound finds some on the
// fly (recommender.entryArtistsFor). Moons are linked to their planet ("a variation of …").
for (const p of PLANETS) {
  if (NODES.has(p.id) || !NODES.has(p.family)) continue;
  const node = { id: p.id, name: p.name, kind: 'style', family: p.family, artists: [], tags: [p.tag], generated: true };
  addNode(node);
  addTag(p.tag, node);
  addTag(p.name, node);
  addEdge(p.id, p.family, 'family', `a style of ${NODES.get(p.family).name}`);
}
for (const m of MOONS) {
  const planet = NODES.get(m.planet);
  if (NODES.has(m.id) || !planet) continue;
  const node = { id: m.id, name: m.name, kind: 'moon', planet: m.planet, family: planet.family, artists: [], tags: [m.tag], generated: true };
  addNode(node);
  addTag(m.tag, node);
  addTag(m.name, node);
  addEdge(m.id, m.planet, 'variation', `a variation of ${planet.name}`);
}

/** Extra MusicBrainz tags that identify a whole family (genre) rather than a style. */
export const FAMILY_TAGS = {
  pop: ['pop'],
  'hip-hop': ['hip hop', 'hip-hop', 'rap', 'hiphop'],
  rock: ['rock'],
  dance: ['dance'],
  rnb: ['r&b', 'rnb', 'rhythm and blues'],
  alternative: ['alternative', 'alternative rock', 'indie rock'],
  electro: ['electronic', 'electro', 'electronica'],
  folk: ['folk'],
  reggae: ['reggae'],
  jazz: ['jazz'],
  country: ['country'],
  chanson: ['chanson', 'chanson française', 'french'],
  classical: ['classical'],
  'films-games': ['soundtrack', 'film score', 'video game music', 'anime'],
  metal: ['metal', 'heavy metal'],
  'soul-funk': ['soul', 'funk'],
  african: ['african', 'afropop'],
  arabic: ['arabic'],
  asian: ['japanese', 'korean', 'chinese', 'c-pop'],
  blues: ['blues'],
  brazilian: ['brazilian', 'mpb'],
  indian: ['indian', 'filmi'],
  latin: ['latin', 'latin pop'],
};
const byFamilyTag = new Map();
for (const [fid, tags] of Object.entries(FAMILY_TAGS)) for (const t of tags) if (!byFamilyTag.has(t)) byFamilyTag.set(t, fid);

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export const familyByName = (name) => FAMILIES.find((f) => f.name.toLowerCase() === String(name || '').toLowerCase());
export const familyByDeezerId = (id) => FAMILIES.find((f) => f.deezerId === Number(id));

/** Node for a genre or sub-genre display name (as stored on tracks). */
export function nodeByName(name) {
  return name ? byName.get(String(currentStyleName(name)).toLowerCase()) || null : null;
}

/**
 * Where a song sits on the Music Map: { family, style, moon } node ids (null when unknown).
 * The one rule used everywhere (cards, Music Map, Decks, Blind Spot, recommender): a moon
 * belongs to its planet and a planet to its sun, whatever the album's Deezer genre says;
 * that genre only picks the sun when no planet is known.
 */
export function placeTrack(track) {
  const ofKind = (name, kind) => {
    const n = nodeByName(name);
    return n && n.kind === kind ? n : null;
  };
  const moon = ofKind(track && track.moon, 'moon');
  const style = moon ? NODES.get(moon.planet) : ofKind(track && track.subGenre, 'style');
  const family = style ? NODES.get(style.family) : familyByName(track && track.genre);
  return { family: family ? family.id : null, style: style ? style.id : null, moon: moon ? moon.id : null };
}

/** The most specific node describing a track (its planet, else its sun). */
export function nodeForTrack(track) {
  const p = placeTrack(track);
  return NODES.get(p.style || p.family) || null;
}

export const neighbors = (id) => adj.get(id) || [];
export const edgeBetween = (a, b) => neighbors(a).find((e) => e.to === b) || null;

/** The most meaningful bridge along a path: the first edge that isn't just "a style of". */
export function bridgeOnPath(path, { last = false } = {}) {
  const edges = [];
  for (let i = 1; i < path.length; i++) {
    const e = edgeBetween(path[i - 1], path[i]);
    if (e) edges.push(e);
  }
  const meaningful = edges.filter((e) => e.type !== 'family');
  return (last ? meaningful[meaningful.length - 1] : meaningful[0]) || edges[edges.length - 1] || null;
}
export const stylesOf = (familyId) => [...NODES.values()].filter((n) => n.kind === 'style' && n.family === familyId);
/** Variations (moons) of a sub-genre (planet). */
export const moonsOf = (planetId) => [...NODES.values()].filter((n) => n.kind === 'moon' && n.planet === planetId);

/**
 * Map MusicBrainz tags to the best STYLE node. Tags are ordered most-voted first;
 * styles inside the track's family win ties. Returns null if nothing matches.
 */
export function matchTagsToNode(tags, familyName) {
  return matchTags(tags, familyName).style;
}

/**
 * Best { style, moon } for a list of tags (most-voted first). A tag naming a moon gives
 * that moon and its planet; styles inside the track's family win ties.
 */
export function matchTags(tags, familyName) {
  const fam = familyByName(familyName);
  let best = { style: null, moon: null };
  let bestScore = -Infinity;
  (tags || []).forEach((tag, i) => {
    for (const node of byTag.get(String(tag).toLowerCase()) || []) {
      if (node.kind !== 'style' && node.kind !== 'moon') continue;
      const style = node.kind === 'moon' ? NODES.get(node.planet) : node;
      // Curated styles are better known: a small edge over generated ones on equal footing.
      const score = -i + (fam && node.family === fam.id ? 5 : 0) + (node.generated ? 0 : 0.5);
      if (score > bestScore) {
        best = { style, moon: node.kind === 'moon' ? node : null };
        bestScore = score;
      }
    }
  });
  return best;
}

/**
 * Classify an artist from its MusicBrainz tags (most-voted first):
 * { family, style } node ids, either may be null. A style implies its family.
 */
export function classifyTags(tags) {
  const { style, moon } = matchTags(tags);
  if (style) return { family: style.family, style: style.id, moon: moon ? moon.id : null };
  for (const tag of tags || []) {
    const fid = byFamilyTag.get(String(tag).toLowerCase());
    if (fid) return { family: fid, style: null, moon: null };
  }
  return { family: null, style: null, moon: null };
}

/** Family-to-family links: the constellation lines of the Music Map. */
export function familyLinks() {
  const out = [];
  for (const [a, list] of adj) {
    if (NODES.get(a).kind !== 'family') continue;
    for (const e of list) if (NODES.get(e.to).kind === 'family' && a < e.to) out.push({ a, b: e.to, why: e.why });
  }
  return out;
}

/**
 * Multi-source BFS from a set of node ids.
 * Returns Map(id -> { dist, from (source id), via (edge used to arrive) }).
 */
export function distancesFrom(sourceIds) {
  const out = new Map();
  const queue = [];
  for (const s of sourceIds) {
    if (NODES.has(s) && !out.has(s)) {
      out.set(s, { dist: 0, from: s, via: null, prev: null });
      queue.push(s);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    const cur = out.get(id);
    for (const e of neighbors(id)) {
      if (out.has(e.to)) continue;
      out.set(e.to, { dist: cur.dist + 1, from: cur.from, via: e, prev: id });
      queue.push(e.to);
    }
  }
  return out;
}

/** Path of node ids from the nearest source to `id` using a distancesFrom() map. */
export function pathTo(distMap, id) {
  const path = [];
  let cur = id;
  while (cur && distMap.has(cur)) {
    path.unshift(cur);
    cur = distMap.get(cur).prev;
  }
  return path;
}

export const allStyles = () => [...NODES.values()].filter((n) => n.kind === 'style');
export const graphStats = () => ({
  nodes: NODES.size,
  edges: [...adj.values()].reduce((s, l) => s + l.length, 0) / 2,
});
