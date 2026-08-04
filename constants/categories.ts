import { Category } from '../types';

/**
 * Keywords used to detect a category for the WHOLE receipt — driven by store
 * names + receipt-level body text. Don't add line-item-only signals here;
 * those live in ITEM_CATEGORY_HINTS below.
 */
export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  Groceries: [
    'walmart', 'kroger', 'safeway', 'whole foods', 'trader joe', 'aldi', 'costco',
    'target', 'publix', 'wegmans', 'food lion', 'giant', 'stop & shop', 'meijer',
    'sprouts', 'fresh market', 'grocery', 'supermarket', 'tesco', 'sainsbury',
    'lidl', 'asda', 'waitrose', 'co-op', 'spar', 'loblaws', 'sobeys', 'metro',
    'no frills', 'food basics', 'fortinos',
  ],
  Electronics: [
    'best buy', 'apple store', 'samsung', 'microsoft store', 'newegg', 'b&h photo',
    'micro center', 'fry electronics', 'frys', 'currys', 'pc world',
    'electronics', 'tech',
  ],
  Dining: [
    'mcdonald', 'starbucks', 'chipotle', 'subway', 'burger king', "wendy's", 'taco bell',
    'pizza hut', 'domino', 'kfc', 'chick-fil-a', 'panera', 'olive garden', "applebee's",
    'restaurant', 'cafe', 'café', 'coffee shop', 'diner', 'bistro', 'grill', 'bar & grill',
    'steakhouse', 'pub',
  ],
  Pharmacy: [
    'cvs', 'walgreens', 'rite aid', 'duane reade', 'pharmacy', 'drug store', 'drugstore',
    'boots', 'lloyds pharmacy', 'superdrug', 'shoppers drug', 'rexall', 'jean coutu',
  ],
  Gas: [
    'shell', 'bp', 'chevron', 'exxon', 'mobil', 'texaco', 'sunoco', 'marathon',
    'speedway', 'circle k', 'wawa', "love's", 'pilot flying j', "casey's",
    'esso', 'total energies', 'petro-canada', 'husky', 'irving',
    'gas station', 'fuel station',
  ],
  Clothing: [
    'h&m', 'zara', 'gap', 'old navy', 'banana republic', 'j.crew', 'uniqlo', 'forever 21',
    'express', 'american eagle', 'hollister', 'abercrombie', "victoria's secret",
    'nike store', 'adidas store', 'under armour store', 'nordstrom', "macy's",
    'bloomingdale', 'primark', 'topshop', 'next', 'marks & spencer', 'lululemon',
  ],
  Entertainment: [
    'amc theaters', 'regal cinema', 'cinemark', 'odeon', 'vue cinema',
    'netflix', 'spotify', 'hulu', 'disney+', 'amazon prime',
    'steam', 'playstation store', 'xbox game pass', 'nintendo eshop',
    'concert', 'ticketmaster', 'stubhub', 'eventbrite',
    'museum', 'zoo', 'aquarium', 'theme park',
  ],
  Travel: [
    'united airlines', 'delta airlines', 'american airlines', 'southwest', 'jetblue',
    'spirit airlines', 'ryanair', 'easyjet', 'british airways', 'emirates',
    'air canada', 'westjet', 'lufthansa', 'klm', 'air france',
    'marriott', 'hilton', 'hyatt', 'sheraton', 'holiday inn', 'motel 6', 'best western',
    'airbnb', 'vrbo', 'booking.com', 'expedia',
    'uber', 'lyft', 'taxi', 'car rental', 'hertz', 'enterprise', 'avis', 'budget rent',
    'airport', 'hotel', 'resort', 'cruise',
  ],
  Healthcare: [
    'hospital', 'medical center', 'clinic', 'urgent care', 'emergency room',
    'dental', 'dentist', 'orthodontist', 'vision center', 'optometrist', 'ophthalmologist',
    'lab corp', 'quest diagnostics', 'radiology', 'imaging center',
    'physical therapy', 'chiropractor', 'dermatologist', 'cardiologist',
    'copay', 'deductible', 'specialist visit',
  ],
  Electricity: [
    'electric company', 'electric utility', 'power company', 'power utility',
    'electricity bill', 'electric bill', 'hydro bill', 'hydro-quebec',
    'hydro one', 'pg&e', 'con edison', 'con ed', 'duke energy',
    'national grid', 'dominion energy', 'southern company', 'xcel energy',
    'entergy', 'pepco', 'eversource', 'centerpoint energy', 'bge',
    'ameren', 'firstenergy', 'nrg energy', 'direct energy', 'toronto hydro',
    'bc hydro', 'sask power', 'nova scotia power', 'utility bill',
  ],
  Other: [],
};

/**
 * Keywords scored ONLY when categorizing a single line item. Tuned for
 * abbreviated, noisy product names you see on grocery / big-box receipts.
 *
 * Ordering matters for ties: Object.entries iterates in insertion order, and
 * Array.sort is stable, so categories listed FIRST win on equal scores.
 * Groceries → Healthcare → Pharmacy → Electronics → Clothing → Entertainment
 * → Travel → Gas → Other.
 */
export const ITEM_CATEGORY_HINTS: Partial<Record<Category, string[]>> = {
  Groceries: [
    // Dairy
    'milk', 'cream ', 'whipping cream', 'half and half', 'butter', 'ghee', 'paneer',
    'mozzarella', 'cheddar', 'parmesan', 'romano', 'brie', 'feta', 'gouda', 'ricotta',
    'cottage cheese', 'sour cream', 'kefir', 'yogurt', 'yoghurt', 'cheese', 'cream cheese',
    'buttermilk', 'evaporated milk', 'condensed milk', 'almond milk', 'oat milk',
    'soy milk', 'coconut milk',

    // Meat / poultry — short tokens like 'ham', 'veal', 'duck' are
    // space-padded so they don't match "hammer", "reveal", "duckweed", etc.
    'chicken', 'beef', 'pork', 'lamb', ' veal ', ' duck ', 'goose', 'turkey', ' ham ',
    'bacon', 'sausage', 'pepperoni', 'prosciutto', 'salami', 'jerky', 'hot dog',
    'burger patty', 'meatball', 'steak', 'fillet', 'rib eye', 'ribeye', 'ribs',
    'ground beef', 'ground pork', 'ground turkey', 'ground chicken', 'chuck',
    'brisket', 'tenderloin', 'sirloin', 'pastrami', 'corned beef', 'liver',

    // Seafood
    'shrimp', 'salmon', 'tuna', 'cod', 'tilapia', 'mahi', 'lobster', 'crab',
    'scallop', 'octopus', 'squid', 'mussel', 'oyster', 'clam', 'sardine',
    'anchovy', 'mackerel', 'haddock', 'halibut', 'swordfish', 'caviar',
    'crawfish', 'fish stick',

    // Eggs / breakfast
    'egg ', 'eggs', 'omelet', 'omelette', 'frittata', 'pancake', 'waffle',
    'french toast', 'crepe', 'breakfast burrito',

    // Bakery
    'bread', 'baguette', 'ciabatta', 'sourdough', 'whole wheat', 'rye bread',
    'focaccia', 'bagel', 'muffin', 'scone', 'cupcake', 'cake', ' pie ', 'tart',
    'brownie', 'danish', 'donut', 'doughnut', 'croissant', 'crois', 'bun ',
    'roll ', 'biscuit', 'cookie', 'cracker', 'pretzel', 'pita', 'naan',
    'tortilla', 'flat bread', 'flatbread',

    // Sweets — bare 'choc' so abbreviated names like 'MRKIPCHOC' or
    // 'CHOCBAR' still match. 'gummy' alone is too greedy (overlaps with
    // 'multivitamin gummy' which should be Pharmacy), so we use compound
    // forms here and let pharmacy-style gummy vitamins take that hit.
    'chocolate', 'choc', 'cocoa', 'candy', ' gum ', 'lollipop',
    'marshmallow', 'fudge', 'toffee', 'caramel', 'gummy bear', 'gummy worm',
    'gummy candy', 'sour gummy', 'fruit gummy', 'licorice',
    'ice cream', 'sorbet', 'gelato', 'sherbet', 'frozen yogurt', 'popsicle',
    'truffle', 'praline', 'chip cookie', 'sugar cookie',

    // Fruits
    'apple', 'banana', 'orange', 'lemon', 'lime', 'pineapple', 'watermelon',
    'cantaloupe', 'honeydew', 'peach', 'pear', 'plum', 'kiwi',
    'papaya', 'coconut', 'avocado', ' fig ', 'date ', 'raisin', 'cherry',
    'cherries', 'strawberry', 'strawberries', 'blueberry', 'blueberries',
    'raspberry', 'raspberries', 'blackberry', 'blackberries', 'grape',
    'grapes', 'mango', 'guava', 'pomegranate', 'persimmon', 'apricot',
    'nectarine', 'tangerine', 'clementine', 'grapefruit', 'lychee', 'cranberry',

    // Vegetables
    'lettuce', 'tomato', 'tomatoes', 'potato', 'potatoes', 'onion', 'garlic',
    'carrot', 'spinach', 'kale', 'arugula', 'cabbage', 'broccoli', 'cauliflower',
    'asparagus', 'eggplant', 'aubergine', 'zucchini', 'squash', 'pumpkin',
    'mushroom', 'mushrooms', 'corn ', 'sweet corn', 'peas', 'green bean',
    'green beans', 'lima bean', 'black bean', 'kidney bean', 'pinto bean',
    'chickpea', 'lentil', 'edamame',
    'cucumber', 'celery', 'radish', 'beet', 'beetroot', 'turnip', 'parsnip',
    'leek', 'shallot', 'scallion', 'green onion', 'chive', 'bell pepper',
    'jalapeno', 'jalapeño', 'serrano', 'habanero', 'okra', 'artichoke',
    'brussels sprout', 'arugula', 'collard', 'swiss chard',

    // Grains / pasta / cereal
    'rice', 'basmati', 'jasmine rice', 'brown rice', 'wild rice', 'risotto',
    'oats', 'oatmeal', 'porridge', 'quinoa', 'barley', 'couscous', 'bulgur',
    'spelt', 'farro', 'amaranth', 'millet',
    'pasta', 'spaghetti', 'penne', 'rigatoni', 'fettuccine', 'lasagna',
    'lasagne', 'ravioli', 'tortellini', 'gnocchi', 'linguine', 'macaroni',
    ' noodle', 'noodles', 'ramen', 'udon', 'soba', 'rice noodle', 'vermicelli',
    'orzo', 'angel hair',
    'flour', 'baking powder', 'baking soda', 'yeast',
    'cereal', 'granola', 'muesli', 'cornflake', 'wheaties', 'cheerio',
    'frosted flakes',

    // Beverages (non-alcoholic)
    'soda', 'pop ', 'coke ', 'pepsi', 'sprite', 'fanta', 'mountain dew',
    'dr pepper', 'root beer', 'ginger ale', 'tonic water',
    'juice', 'orange juice', 'apple juice', 'cranberry juice', 'grape juice',
    'lemonade', 'limeade', 'iced tea',
    'sparkling water', 'seltzer', 'club soda', 'mineral water',
    'gatorade', 'powerade', 'vitamin water', 'energy drink', 'red bull',
    'monster energy', 'rockstar',
    'coffee', 'espresso', 'instant coffee', 'decaf', 'cappuccino', 'latte',
    'americano', 'mocha', 'macchiato', 'k-cup', 'k cup', 'pod ',
    ' tea ', 'green tea', 'black tea', 'herbal tea', 'chamomile', 'matcha',
    'milk tea', 'boba', 'kombucha',
    'smoothie', 'milkshake',

    // Condiments / sauces / spreads
    'ketchup', 'mustard', ' mayo', 'mayonnaise', 'aioli', 'vinaigrette',
    'salad dressing', 'ranch dressing', 'caesar', 'thousand island',
    'salsa', 'pico de gallo', 'guacamole', 'hummus', 'tahini', 'tzatziki',
    'soy sauce', 'tamari', 'fish sauce', 'oyster sauce', 'hoisin',
    'hot sauce', 'sriracha', 'tabasco', 'chili sauce', 'chipotle',
    'bbq sauce', 'barbecue sauce', 'gravy', 'pesto', 'marinara', 'alfredo',
    'pasta sauce', 'tomato sauce', 'tomato paste',
    'syrup', 'maple syrup', 'honey', 'molasses', 'agave',
    ' jam ', 'jelly', 'marmalade', 'preserves', 'fruit spread',
    'peanut butter', 'almond butter', 'nutella', 'hazelnut spread',
    'vinegar', 'balsamic', 'apple cider vinegar', 'rice vinegar',
    'olive oil', 'vegetable oil', 'canola oil', 'coconut oil', 'sesame oil',
    'avocado oil', 'cooking spray',

    // Spices / herbs / seasonings
    ' salt', 'pepper ', 'black pepper', 'garlic powder', 'onion powder',
    'cinnamon', 'nutmeg', 'allspice', 'cloves', 'cardamom', 'turmeric',
    'cumin', 'paprika', 'coriander', 'oregano', ' basil ', 'thyme',
    'rosemary', ' sage ', 'parsley', 'cilantro', ' dill', 'tarragon',
    'bay leaf', 'curry powder', 'garam masala', 'chili powder',
    'cayenne', 'red pepper flake', 'sumac', 'saffron', 'vanilla',

    // Snacks / nuts / chips
    'chip', 'chips', 'crisps', 'tortilla chip', 'pretzel', 'popcorn',
    'rice cake', 'granola bar', 'energy bar', 'protein bar', 'fruit snack',
    'trail mix', 'beef jerky',
    'peanut', 'peanuts', 'almond', 'almonds', 'cashew', 'cashews',
    'pistachio', 'pistachios', 'walnut', 'walnuts', 'hazelnut', 'hazelnuts',
    'pecan', 'pecans', 'macadamia', 'pine nut', 'sunflower seed', 'pumpkin seed',

    // Frozen / prepared meals
    'frozen pizza', 'frozen meal', 'lean cuisine', 'stouffer', 'tv dinner',
    'pot pie', 'chicken nugget', 'frozen vegetable', 'frozen fruit',
    'frozen waffle', 'frozen burrito', 'frozen entree',
    'pizza ', 'enchilada', 'burrito', 'taco ', 'quesadilla',
    'dumpling', 'gyoza', 'pierogi', 'spring roll', 'samosa', 'falafel',

    // Asian / specialty
    'kimchi', 'miso', 'sushi', 'wasabi', 'nori', 'seaweed', 'tofu',
    'tempeh', 'seitan', 'kombu', 'dashi',

    // Specific brand or generic packaging language
    'organic', 'gluten free', 'gluten-free', 'low fat', 'fat free',
    'whole grain', 'multigrain',
  ],

  Healthcare: [
    // Fitness equipment & gym gear
    'yoga', 'yoga mat', 'pilates', 'dumbbell', 'kettlebell', 'barbell',
    'weight plate', 'resistance band', 'jump rope', 'foam roller',
    'medicine ball', 'exercise ball', 'pull-up bar', 'pull up bar',
    'treadmill', 'elliptical', 'stationary bike', 'rowing machine',
    'neopren', 'neoprene',
    '2lb', '3lb', '5lb', '8lb', '10lb', '12lb', '15lb', '20lb', '25lb',
    '30lb', '35lb', '40lb', '45lb', '50lb', '1kg', '2kg', '5kg', '10kg',
    'rubber dumbbell', 'rubber weight', 'rubber plate', 'cast iron weight',
    'fitness tracker', 'heart rate monitor', 'pulse oximeter',
    'blood pressure', 'thermometer', 'glucose meter', 'glucose strip',
    'gym bag', 'water bottle', 'shaker bottle',
    'mouthguard', 'shin guard', 'athletic tape',

    // First aid / medical supplies
    'bandage', 'band-aid', 'band aid', 'gauze', 'medical tape',
    'first-aid', 'first aid',
    'crutch', ' cane ', 'walker ', 'wheelchair', 'compression sock',
    'compression sleeve',
    'knee brace', 'wrist brace', 'ankle brace', 'back brace', 'elbow brace',
    'heating pad', 'ice pack', 'cold pack', 'hot pack',
    'antiseptic', 'rubbing alcohol', 'hydrogen peroxide', 'iodine',
    'cotton ball', 'cotton swab', 'q-tip', 'q tip', 'finger splint',

    // Health-store supplements
    'protein powder', 'whey protein', 'casein',
    'creatine', 'pre-workout', 'pre workout', 'bcaa', 'eaa',
    'glucosamine', 'chondroitin',
    'fish oil', 'omega-3', 'omega 3', 'collagen', 'biotin', 'melatonin',
    'magnesium', 'iron supplement', 'zinc', 'probiotic',
    'turmeric capsule', 'ashwagandha', 'spirulina', 'chlorella',
  ],

  Pharmacy: [
    // Pain / fever
    'tylenol', 'advil', 'motrin', 'ibuprofen', 'aspirin', 'aleve', 'naproxen',
    'excedrin', 'midol', 'acetaminophen', 'paracetamol',

    // Cold / flu / cough
    'sudafed', 'mucinex', 'robitussin', 'nyquil', 'dayquil', 'theraflu',
    'cough drop', 'halls', 'ricola', 'cough syrup', 'lozenge', 'vicks',
    'menthol', 'vapor rub',

    // Allergy
    'claritin', 'zyrtec', 'allegra', 'benadryl', 'flonase', 'nasacort',
    'nasal spray',

    // Stomach / digestive
    'pepto', 'tums ', 'rolaids', 'prilosec', 'zantac', 'pepcid', 'prevacid',
    'imodium', 'dramamine', 'antacid', 'laxative', 'fiber supplement',
    'metamucil', 'miralax', 'gas-x',

    // Personal care — body
    'shampoo', 'conditioner', 'hair gel', 'hair spray', 'mousse',
    'body wash', 'shower gel', 'soap bar', 'bar soap', 'hand soap',
    'deodorant', 'antiperspirant', 'perfume', 'cologne', 'body spray',
    'lotion', 'moisturizer', 'body lotion', 'hand cream', 'foot cream',
    'sunscreen', 'sunblock', ' spf ',
    'razor ', 'shaving cream', 'aftershave', 'beard oil', 'beard balm',

    // Feminine / family
    'tampon', ' pad ', 'panty liner', 'menstrual cup', 'feminine wash',
    'condom',
    'pregnancy test', 'ovulation test',

    // Eye care
    'contact lens', 'contact solution', 'eye drops', 'visine',

    // Oral care
    'toothbrush', 'toothpaste', 'mouthwash', 'listerine', 'crest', 'colgate',
    'sensodyne', 'oral-b', 'oral b', 'dental floss', 'floss pick',
    'tongue scraper', 'denture',

    // Skincare
    'serum', 'toner', 'cleanser', 'face wash', 'face cream',
    'eye cream', 'face mask', 'sheet mask', 'exfoliator', 'face scrub',
    'retinol', 'hyaluronic acid', 'niacinamide', 'salicylic acid',
    'benzoyl peroxide', 'micellar water',
    'cetaphil', 'cerave', 'neutrogena', 'olay', "l'oreal", 'la roche',
    'aveeno', 'eucerin', 'nivea', 'clinique',

    // Makeup / cosmetics
    'lipstick', 'lip gloss', 'lip balm', 'chapstick', 'lip liner',
    'foundation', 'concealer', 'compact', 'setting spray',
    'mascara', 'eyeliner', 'eyeshadow', 'blush', 'bronzer', 'highlighter',
    'primer ', 'makeup remover', 'nail polish', 'nail file', 'nail clipper',
    'tweezer', 'cuticle', 'press on nail', 'press-on nail',

    // Hair extras
    'hair dye', 'hair color', 'hair brush', 'hair tie', 'bobby pin',
    'hairband', 'hair clip', 'detangler',

    // Vitamins
    'vitamin a', 'vitamin b', 'vitamin c', 'vitamin d', 'vitamin e',
    'vitamin k', 'multivitamin', 'centrum', 'one a day', 'flintstone',
    'gummy vitamin',
  ],

  Electronics: [
    // Computers
    'laptop', 'macbook', 'chromebook', 'desktop', 'gaming pc', ' pc ',
    'workstation', 'all-in-one', 'mini pc',
    // Tablets
    'tablet', 'ipad', 'galaxy tab', 'surface ', 'kindle ', 'fire tablet',
    // Phones
    'iphone', 'galaxy s', 'galaxy note', 'galaxy z', 'pixel ', 'oneplus',
    'xiaomi', 'oppo', 'huawei', 'smartphone',
    // Wearables
    'apple watch', 'galaxy watch', 'fitbit', 'garmin', 'wearable',
    'smartwatch', 'oura ring',
    // Audio
    'headphone', 'earbud', 'airpods', 'beats studio', 'beats solo',
    'sony wh', 'bose qc', 'speaker', 'soundbar', 'subwoofer',
    'amplifier', 'av receiver', 'turntable',
    'microphone', 'condenser mic', 'usb mic',
    // TV / display
    'television', 'oled', 'qled', '4k tv', '8k tv', 'led tv', 'projector',
    'monitor', 'gaming monitor', 'curved monitor', 'ultrawide',
    'roku', 'chromecast', 'apple tv', 'fire tv', 'fire stick',
    // Gaming
    'playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'switch ', 'steam deck',
    'gaming chair', 'gaming mouse', 'gaming keyboard', 'gaming headset',
    'controller', 'joystick', 'oculus', 'meta quest', 'vr headset',
    // Cameras
    'camera ', 'dslr', 'mirrorless', 'gopro', 'action camera', 'webcam',
    'camcorder', 'lens ', 'tripod', 'gimbal', 'stabilizer', 'drone',
    // Storage / accessories
    ' usb ', 'usb-c', 'usb a', 'flash drive', 'thumb drive', 'sd card',
    'microsd', 'memory card', 'external drive', 'external ssd',
    ' ssd ', ' hdd ', ' nas ',
    'hdmi', 'displayport', 'thunderbolt', 'ethernet cable',
    ' cable', 'charger', 'charging cable', 'power adapter', 'power bank',
    'wireless charger', 'magsafe',
    'mouse ', 'wireless mouse', 'mouse pad', 'keyboard', 'mechanical keyboard',
    'wireless keyboard',
    // Networking
    'router', 'modem', 'wifi extender', 'mesh wifi', 'access point',
    'network switch',
    // PC components
    ' gpu ', 'graphics card', ' cpu ', 'processor', ' ram ',
    'motherboard', 'pc case', 'power supply', 'heatsink', 'cooler ',
    // Smart home
    'alexa', 'echo dot', 'google home', 'google nest', 'nest thermostat',
    'ring doorbell', 'ring camera', 'smart bulb', 'smart plug', 'philips hue',
    'smart lock', 'security camera', 'baby monitor',
    // Misc accessories
    'e-reader', 'phone case', 'screen protector', 'tempered glass',
    'popsocket', 'selfie stick', 'ring light', 'phone tripod',
    'calculator ', 'label maker', 'walkie talkie',
    // Consumer electronic batteries
    'aa battery', 'aaa battery', '9v battery', 'cr2032', 'cr2025',
    'lithium battery', 'rechargeable battery',
  ],

  Clothing: [
    // Tops
    't-shirt', 'tshirt', 'tee shirt', 'polo shirt', ' polo ', 'blouse',
    'tank top', 'tank-top', 'hoodie', 'sweatshirt', 'cardigan',
    'sweater', 'jumper', 'pullover', ' vest ', 'blazer', 'jacket',
    'parka', 'raincoat', 'windbreaker', 'fleece', 'puffer', 'trench coat',
    'peacoat',

    // Bottoms
    ' pants', 'trousers', 'jeans', 'denim', 'chinos', 'slacks', 'shorts',
    'mini skirt', 'pencil skirt', 'maxi skirt',
    'leggings', 'tights', 'sweatpants', 'joggers', 'cargo pants',

    // Dresses
    ' dress', 'sundress', 'maxi dress', 'midi dress', 'cocktail dress',

    // Underwear / sleepwear
    'underwear', ' briefs', 'boxer ', 'thong', ' panty', 'panties',
    ' bra ', 'sports bra', 'undershirt', 'camisole', ' slip ',
    'pajama', 'pyjama', ' pjs ', 'nightgown', ' robe ', 'bathrobe',

    // Activewear / swimwear
    'activewear', 'athletic wear', 'workout clothes',
    'yoga pant', 'yoga short', 'sports jersey', ' jersey ',
    'swim trunks', 'swimsuit', 'swimwear', 'bikini', 'one-piece swim',
    'rash guard', 'wetsuit',

    // Shoes
    'sneakers', 'running shoes', 'tennis shoes', 'basketball shoe',
    'cleats', 'football boot', 'soccer cleat',
    'boots', 'hiking boot', 'snow boot', 'rain boot', 'work boot',
    'sandals', 'flip flops', 'flip-flops', 'slides', 'slippers',
    'high heel', 'pumps', 'flats ', 'ballet flat', 'oxfords',
    'loafers', 'mules', 'espadrille', 'dress shoe',

    // Hosiery
    'socks', 'crew sock', 'ankle sock', 'pantyhose', 'stocking',

    // Accessories (worn)
    'scarf', 'gloves', 'mittens', ' hat ', ' cap ', 'beanie', 'beret',
    'fedora', 'sunhat', 'sunglasses', 'eyeglasses', 'reading glasses',

    // Bags
    'backpack', 'rucksack', 'duffel', 'tote bag', 'tote ', 'purse',
    'handbag', 'crossbody', 'shoulder bag', 'satchel', 'briefcase',
    'fanny pack', 'belt bag', 'wallet', 'cardholder', 'card holder',

    // Jewelry
    'necklace', 'pendant', 'bracelet', 'bangle', 'earring', 'earrings',
    'hoop earring', 'engagement ring', 'wedding ring', 'wedding band',
    'anklet', 'brooch', 'cufflink',

    // Belts / ties
    ' belt ', ' tie ', 'necktie', 'bowtie', 'bow tie', 'suspenders',

    // Brand names (when on a non-brand-store receipt)
    'nike ', 'adidas', ' puma ', 'reebok', 'new balance', 'under armour',
    'north face', 'columbia', 'patagonia', ' levi', 'wrangler',
    ' lee ', 'calvin klein', 'tommy hilfiger', 'ralph lauren', 'lacoste',
    'lululemon', 'champion', ' fila ', 'asics', 'brooks', ' hoka ',
  ],

  Entertainment: [
    // Books / media
    ' book ', 'novel', 'paperback', 'hardcover', 'audiobook', 'magazine',
    'comic', 'manga', 'graphic novel',
    // Music gear
    'vinyl', 'lp record', ' cd ', 'album', 'cassette',
    'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar',
    'ukulele', ' piano', 'keyboard piano', ' drum ', 'drum kit', 'violin',
    ' cello ',
    // Games
    'board game', 'card game', 'puzzle ', 'jigsaw', 'monopoly', 'scrabble',
    ' chess', 'checkers', 'backgammon', 'playing cards', 'poker chip',
    'lego ', 'megablok', 'building blocks',
    // Toys
    'action figure', ' doll ', 'barbie', ' plush ', 'stuffed animal',
    'rc car ', 'rc helicopter', 'rc boat',
    // Crafts
    ' yarn ', 'knitting needle', 'crochet hook', 'embroidery', ' fabric ',
    'sewing kit', ' thread ', 'sketchbook', 'sketch pad',
    'colored pencil', ' marker ', 'crayon', ' paint ', 'acrylic paint',
    'watercolor', 'canvas ', 'paint brush',
    // Movies / discs
    ' dvd ', 'blu-ray', 'blu ray',
  ],

  Travel: [
    'suitcase', 'carry-on', 'carry on', 'checked bag', 'garment bag',
    'packing cube', 'travel pillow', 'neck pillow', ' eye mask', 'sleep mask',
    'travel mug', 'tsa lock', 'luggage tag', 'travel adapter', 'power converter',
    'passport holder', 'money belt', 'compression bag',
    'tent ', 'sleeping bag', 'camping stove', 'camping chair', ' cooler',
    'hiking pack', 'backpacking',
  ],

  Gas: [
    'gasoline', 'unleaded', 'premium gas', 'regular gas', ' diesel', 'petrol',
    'motor oil', 'engine oil', '5w-30', '5w30', '10w-40', '10w40', '0w-20',
    'transmission fluid', 'brake fluid', 'coolant', 'antifreeze',
    'wiper blade', 'wiper fluid', 'washer fluid',
    ' tire ', ' tyre ', 'jumper cable', 'tow strap',
    'air filter', 'oil filter', 'spark plug', 'car battery',
    'car wash',
  ],

  Other: [
    // Air / odor
    'freshmtic', 'air wick', 'glade', 'febreze', 'air freshener',
    'deodorizer', 'odor remover',
    // Cleaning chemicals / brands
    'cleaner', 'all-purpose cleaner', 'multi-surface cleaner',
    'lysol', 'clorox', 'pine sol', 'pine-sol', 'windex', 'mr clean',
    'scrubbing bubbles', 'soft scrub', 'comet ', 'ajax cleaner',
    'detergent', 'laundry detergent', 'laundry pod', ' tide ', ' gain ',
    'persil', 'arm & hammer', 'arm and hammer',
    'fabric softener', 'downy', 'snuggle', 'bounce ', 'dryer sheet',
    'bleach', 'oxiclean', 'ammonia', 'borax',
    'dish soap', 'dish detergent', 'dawn ', 'palmolive', 'cascade',
    'finish ', 'jet dry',
    'softsoap', 'method ',
    // Paper goods
    'tissue', 'kleenex', 'puffs', 'toilet paper', 'tp roll', 'bath tissue',
    'paper towel', 'bounty ', 'charmin', 'cottonelle', ' scott ', ' viva ',
    'napkin', 'paper plate', 'paper cup', 'plastic cup',
    'plastic plate', 'plastic utensil', ' straw',
    // Wraps / bags
    'aluminum foil', 'aluminium foil', 'plastic wrap', 'saran wrap',
    'cling film', 'parchment paper', 'wax paper',
    'ziploc', 'zip-loc', 'sandwich bag', 'freezer bag', 'storage bag',
    'trash bag', 'garbage bag', 'leaf bag', 'kitchen bag',
    // Cleaning tools
    ' broom ', ' mop ', 'swiffer', 'duster', 'dustpan', 'vacuum', 'roomba',
    'lint roller', 'sponge', 'scouring pad', 'scrub brush', 'rubber glove',
    'cleaning glove', 'microfiber',
    // Kitchenware
    'mixing bowl', 'measuring cup', 'colander', 'strainer', ' whisk',
    'spatula', ' tongs', ' ladle ',
    'baking sheet', 'baking pan', 'roasting pan', 'cookie sheet',
    'muffin tin', 'cake pan', 'pie pan',
    'saucepan', 'frying pan', 'skillet', ' wok ', 'pressure cooker',
    'crock pot', 'instant pot', 'slow cooker', 'rice cooker', 'air fryer',
    'food processor', 'blender', 'mixer ', 'stand mixer', 'hand mixer',
    'toaster', 'toaster oven', 'microwave', 'coffee maker', 'french press',
    'espresso machine', ' kettle',
    // Office
    ' pen ', 'ballpoint', ' pencil', 'mechanical pencil', 'sharpie',
    'highlighter pen', 'eraser', 'ruler ', 'scissors', 'scotch tape',
    'masking tape', 'duct tape', 'electrical tape',
    'super glue', 'glue stick', 'stapler', 'staples ',
    'paper clip', 'binder clip', 'rubber band',
    'binder ', 'folder', 'file folder', 'manila folder', 'notebook',
    'journal', 'planner', 'agenda', 'sticky note', 'post-it', 'envelope',
    'shipping label', 'index card', 'flash card',
    'printer paper', 'copy paper', 'cardstock',
    // Tools / hardware
    'hammer ', 'screwdriver', 'wrench', 'pliers', ' drill ', 'cordless drill',
    ' saw ', 'hand saw', 'circular saw', 'sandpaper',
    'tape measure', ' level ', 'stud finder', 'flashlight', 'work light',
    'utility knife', 'box cutter',
    'nail ', 'screw ', 'bolt ', ' nut ', 'washer ', 'hinge',
    'wall anchor', 'drywall anchor',
    'wall paint', 'house paint', 'primer paint', 'stain ', 'varnish',
    'caulk', 'sealant', 'wood glue', 'epoxy',
    'extension cord', 'power strip', 'surge protector',
    'light bulb', 'led bulb', 'fluorescent', 'lamp shade',
    // Pet
    'dog food', 'cat food', 'kibble', 'pet treat', 'dog treat', 'cat treat',
    'pet biscuit', ' wet food', ' dry food', 'cat litter', 'litter box',
    'scratching post', 'pet bed', 'dog bed', 'cat bed', 'pet toy',
    'leash', 'pet collar', 'harness ', 'pet carrier', 'pet crate', 'kennel',
    'flea treatment', 'tick treatment', 'pet shampoo', 'pet brush',
    // Baby
    'diaper', 'huggies', 'pampers', 'luvs ',
    'baby wipe', 'wet wipe',
    'baby formula', 'enfamil', 'similac',
    'gerber baby',
    'baby lotion', 'baby wash', 'baby shampoo', 'baby powder',
    'pacifier', 'baby bottle', 'sippy cup',
    'stroller', 'car seat', ' crib ', 'bassinet', 'high chair',
    'baby gate', 'baby monitor',
    // Garden / outdoor
    'fertilizer', 'potting soil', 'compost', ' mulch', 'seed packet',
    'flower pot', 'planter', 'watering can', 'garden hose', 'sprinkler',
    'pruning shear', ' rake ', ' shovel ', ' spade ',
    'pesticide', 'insecticide', 'herbicide', 'bug spray', 'mosquito repellent',
    'ant trap', 'roach trap', 'mouse trap', 'rat poison',
    // Misc home
    'candle', 'tea light', 'votive', 'matches ', 'lighter ',
    'curtain', 'shower curtain', 'bath mat', 'bath towel',
    'hand towel', 'washcloth', 'kitchen towel', 'tea towel',
    'bed sheet', ' pillow', 'pillowcase', 'comforter', 'duvet',
    'blanket', 'throw blanket',
    // Generic household trigger words
    ' laundry', 'cleaning supply', 'household',
  ],
};

export const CATEGORY_ICONS: Record<Category, string> = {
  Groceries: '🛒',
  Electronics: '💻',
  Dining: '🍽️',
  Pharmacy: '💊',
  Gas: '⛽',
  Clothing: '👗',
  Entertainment: '🎬',
  Travel: '✈️',
  Healthcare: '🏥',
  Electricity: '⚡',
  Other: '📦',
};

export const ALL_CATEGORIES: Category[] = [
  'Groceries',
  'Electronics',
  'Dining',
  'Pharmacy',
  'Gas',
  'Clothing',
  'Entertainment',
  'Travel',
  'Healthcare',
  'Electricity',
  'Other',
];
