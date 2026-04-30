const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'TeReT_secret_key';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ================= PATHS =================

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const shipmentsFile = path.join(dataDir, 'shipments.json');
const offersFile = path.join(dataDir, 'offers.json');
const notificationsFile = path.join(dataDir, 'notifications.json');

// ================= INIT =================

function ensureDirAndFile(filePath, defaultValue = []) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf8');
  }
}

ensureDirAndFile(usersFile, []);
ensureDirAndFile(shipmentsFile, []);
ensureDirAndFile(offersFile, []);
ensureDirAndFile(notificationsFile, []);

// ================= HELPERS =================

function readJson(filePath) {
  ensureDirAndFile(filePath, []);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error(`Greška pri čitanju ${filePath}:`, error);
    return [];
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getNextId(items) {
  if (!Array.isArray(items) || items.length === 0) return 1;
  return Math.max(...items.map((item) => Number(item.id) || 0)) + 1;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      ime: user.ime || user.fullName || '',
      naziv_tvrtke: user.naziv_tvrtke || user.companyName || '',
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'Nedostaje token.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Neispravan ili istekao token.' });
  }
}

function getUserById(userId) {
  const users = readJson(usersFile);
  return users.find((u) => Number(u.id) === Number(userId)) || null;
}

function addNotification({
  userId,
  type,
  title,
  message,
  shipmentId = null,
  offerId = null,
  createdBy = null,
  meta = {},
}) {
  const notifications = readJson(notificationsFile);

  const notification = {
    id: getNextId(notifications),
    userId: Number(userId),
    type: type || 'info',
    title: title || '',
    message: message || '',
    shipmentId: shipmentId !== null ? Number(shipmentId) : null,
    offerId: offerId !== null ? Number(offerId) : null,
    createdBy: createdBy !== null ? Number(createdBy) : null,
    isRead: false,
    meta: meta || {},
    createdAt: nowIso(),
  };

  notifications.unshift(notification);
  writeJson(notificationsFile, notifications);

  return notification;
}

function addOutbidNotifications({ offers, shipment, currentCarrierId, currentOfferId }) {
  const activeOffers = offers.filter(
    (o) =>
      Number(o.shipmentId) === Number(shipment.id) &&
      o.status !== 'rejected' &&
      o.status !== 'accepted'
  );

  if (activeOffers.length < 2) return;

  const lowestAmount = Math.min(...activeOffers.map((o) => toNumber(o.amount, 0)));

  const outbidOffers = activeOffers.filter(
    (o) =>
      toNumber(o.amount, 0) > lowestAmount &&
      Number(o.carrierId) !== Number(currentCarrierId)
  );

  const notifiedCarrierIds = new Set();

  outbidOffers.forEach((offer) => {
    const carrierId = Number(offer.carrierId);

    if (notifiedCarrierIds.has(carrierId)) return;

    notifiedCarrierIds.add(carrierId);

    addNotification({
      userId: carrierId,
      type: 'offer_outbid',
      title: 'Ponuda više nije najniža',
      message:
        'Vaša ponuda više nije najniža. Pošaljite novu ponudu kako biste ostali konkurentni.',
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: currentCarrierId,
      meta: {
        lowestAmount,
        currentOfferId,
      },
    });
  });
}

function maskAddressKeepStreet(address) {
  const value = normalizeString(address);
  if (!value) return '';

  const match = value.match(/^(.+?)(\s+\d+[a-zA-Z/-]*)$/);
  if (match) {
    return match[1].trim();
  }

  return value;
}

function getShipmentField(shipment, keys = []) {
  for (const key of keys) {
    if (shipment[key] !== undefined && shipment[key] !== null && shipment[key] !== '') {
      return shipment[key];
    }
  }
  return '';
}

function canUserSeeFullContact({ shipment, viewer, offers }) {
  if (!shipment || !viewer) return false;

  if (viewer.role === 'sender' && Number(shipment.senderId) === Number(viewer.id)) {
    return true;
  }

  if (viewer.role !== 'carrier' && viewer.role !== 'transporter') {
    return false;
  }

  const acceptedOffer = offers.find(
    (o) =>
      Number(o.shipmentId) === Number(shipment.id) &&
      (o.status === 'accepted' || o.status === 'prihvaceno' || o.status === 'prihvaćeno')
  );

  if (!acceptedOffer) return false;

  return (
    Number(acceptedOffer.carrierId) === Number(viewer.id) &&
    acceptedOffer.contactUnlocked === true
  );
}

function sanitizeShipmentForViewer(shipment, viewer, offers) {
  const showFullContact = canUserSeeFullContact({ shipment, viewer, offers });

  const adresaUtovara =
    getShipmentField(shipment, ['adresa_utovara', 'pickupAddress', 'adresaUtovara']) || '';
  const adresaIstovara =
    getShipmentField(shipment, ['adresa_istovara', 'deliveryAddress', 'adresaIstovara']) || '';
  const phone =
    getShipmentField(shipment, ['phone', 'telefon', 'broj_telefona', 'senderPhone']) || '';

  return {
    ...shipment,
    adresa_utovara: showFullContact ? adresaUtovara : maskAddressKeepStreet(adresaUtovara),
    adresa_istovara: showFullContact ? adresaIstovara : maskAddressKeepStreet(adresaIstovara),
    phone: showFullContact ? phone : '',
    telefon: showFullContact ? phone : '',
    senderPhone: showFullContact ? phone : '',
    contact_unlocked: showFullContact,
  };
}

function isCarrierRole(role) {
  return role === 'carrier' || role === 'transporter';
}

function getOfferBidHistory(offer) {
  if (Array.isArray(offer.bidHistory) && offer.bidHistory.length > 0) {
    return offer.bidHistory;
  }

  return [
    {
      amount: toNumber(offer.amount, 0),
      createdAt: offer.createdAt || offer.updatedAt || nowIso(),
    },
  ];
}

function buildBidHistoryForViewer({ shipment, offers, users, viewer }) {
  const shipmentOffers = offers.filter(
    (o) => Number(o.shipmentId) === Number(shipment.id)
  );

  const allBids = [];

  shipmentOffers.forEach((offer) => {
    const history = getOfferBidHistory(offer);
    const carrier = users.find((u) => Number(u.id) === Number(offer.carrierId));
    const isMyOffer = Number(offer.carrierId) === Number(viewer.id);
    const isSenderOwner =
      viewer.role === 'sender' && Number(shipment.senderId) === Number(viewer.id);

    history.forEach((historyItem, index) => {
      allBids.push({
        offerId: offer.id,
        shipmentId: offer.shipmentId,
        carrierId: isSenderOwner || isMyOffer ? offer.carrierId : null,
        carrierName:
          isSenderOwner || isMyOffer
            ? carrier?.fullName || ''
            : 'Drugi prijevoznik',
        carrierCompany:
          isSenderOwner || isMyOffer
            ? carrier?.companyName || ''
            : '',
        amount: toNumber(historyItem.amount, 0),
        status: offer.status,
        isMyOffer,
        isAccepted: offer.status === 'accepted',
        isRejected: offer.status === 'rejected',
        bidNumber: index + 1,
        createdAt: historyItem.createdAt || offer.createdAt || offer.updatedAt || nowIso(),
      });
    });
  });

  allBids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const activeBids = allBids.filter((bid) => bid.status !== 'rejected');
  const lowestAmount =
    activeBids.length > 0
      ? Math.min(...activeBids.map((bid) => toNumber(bid.amount, 0)))
      : null;

  return allBids.map((bid) => ({
    ...bid,
    isLowest: lowestAmount !== null && toNumber(bid.amount, 0) === lowestAmount,
  }));
}

// ================= ROOT =================

app.get('/', (req, res) => {
  res.json({ message: 'TeReT backend radi.' });
});

// ================= AUTH =================

app.post('/register', async (req, res) => {
  try {
    const users = readJson(usersFile);

    const fullName = normalizeString(req.body.fullName || req.body.ime);
    const companyName = normalizeString(req.body.companyName || req.body.naziv_tvrtke);
    const email = normalizeString(req.body.email).toLowerCase();
    const phone = normalizeString(req.body.phone || req.body.telefon);
    const password = String(req.body.password || '');
    const role = normalizeString(req.body.role);

    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({
        message: 'fullName, email, phone, password i role su obavezni.',
      });
    }

    if (!['sender', 'carrier', 'transporter'].includes(role)) {
      return res.status(400).json({ message: 'Neispravna uloga korisnika.' });
    }

    const existingUser = users.find((u) => u.email.toLowerCase() === email);
    if (existingUser) {
      return res.status(400).json({ message: 'Korisnik s tim emailom već postoji.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: getNextId(users),
      fullName,
      companyName,
      email,
      phone,
      password: hashedPassword,
      role: role === 'transporter' ? 'carrier' : role,
      createdAt: nowIso(),
    };

    users.push(newUser);
    writeJson(usersFile, users);

    const token = createToken(newUser);

    res.status(201).json({
      message: 'Registracija uspješna.',
      token,
      user: {
        id: newUser.id,
        fullName: newUser.fullName,
        companyName: newUser.companyName,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error('Greška /register:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    console.log('LOGIN BODY:', req.body);

    const users = readJson(usersFile);

    const email = normalizeString(req.body.email).toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email i password su obavezni.' });
    }

    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      return res.status(401).json({ message: 'Pogrešan email ili lozinka.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Pogrešan email ili lozinka.' });
    }

    const token = createToken(user);

    res.json({
      message: 'Prijava uspješna.',
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        companyName: user.companyName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Greška /login:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/me', authMiddleware, (req, res) => {
  const user = getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'Korisnik nije pronađen.' });
  }

  res.json({
    id: user.id,
    fullName: user.fullName,
    companyName: user.companyName,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });
});

// ================= SHIPMENTS =================

app.post('/shipments', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({ message: 'Samo naručitelj može objaviti teret.' });
    }

    const shipments = readJson(shipmentsFile);
    const users = readJson(usersFile);

    const sender = users.find((u) => Number(u.id) === Number(req.user.id));
    if (!sender) {
      return res.status(404).json({ message: 'Korisnik nije pronađen.' });
    }

    const newShipment = {
      id: getNextId(shipments),
      senderId: Number(req.user.id),
      status: 'aktivan',
      naziv_tereta: req.body.naziv_tereta || req.body.title || '',
      opis_tereta: req.body.opis_tereta || req.body.description || '',
      mjesto_utovara: req.body.mjesto_utovara || '',
      adresa_utovara: req.body.adresa_utovara || '',
      mjesto_istovara: req.body.mjesto_istovara || '',
      adresa_istovara: req.body.adresa_istovara || '',
      datum_utovara: req.body.datum_utovara || '',
      rok_licitacije: req.body.rok_licitacije || '',
      tezina_kg: req.body.tezina_kg || '',
      duzina_cm: req.body.duzina_cm || '',
      sirina_cm: req.body.sirina_cm || '',
      visina_cm: req.body.visina_cm || '',
      broj_paleta: req.body.broj_paleta || '',
      nacin_utovara: req.body.nacin_utovara || '',
      tip_lokacije_utovara: req.body.tip_lokacije_utovara || '',
      tip_lokacije_istovara: req.body.tip_lokacije_istovara || '',
      kat_utovara: req.body.kat_utovara || '',
      kat_istovara: req.body.kat_istovara || '',
      lift_na_utovaru: req.body.lift_na_utovaru ?? false,
      lift_na_istovaru: req.body.lift_na_istovaru ?? false,
      prilaz_za_tegljac: req.body.prilaz_za_tegljac ?? false,
      treba_pomoc_vozaca: req.body.treba_pomoc_vozaca ?? false,
      slike: Array.isArray(req.body.slike) ? req.body.slike.slice(0, 5) : [],
      phone: sender.phone || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    shipments.unshift(newShipment);
    writeJson(shipmentsFile, shipments);

    res.status(201).json({
      message: 'Teret je uspješno objavljen.',
      shipment: newShipment,
    });
  } catch (error) {
    console.error('Greška /shipments POST:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/shipments', authMiddleware, (req, res) => {
  try {
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const activeShipments = shipments.filter((s) => s.status === 'aktivan');

    const result = activeShipments.map((shipment) => {
      const shipmentOffers = offers.filter(
        (o) =>
          Number(o.shipmentId) === Number(shipment.id) &&
          o.status !== 'rejected'
      );

      const activeAmounts = shipmentOffers
        .map((o) => toNumber(o.amount, null))
        .filter((amount) => amount !== null && Number.isFinite(amount));

      const lowestOffer =
        activeAmounts.length > 0 ? Math.min(...activeAmounts) : null;

      const myOffer = offers.find(
        (o) =>
          Number(o.shipmentId) === Number(shipment.id) &&
          Number(o.carrierId) === Number(req.user.id) &&
          o.status !== 'rejected'
      );

      return {
        ...sanitizeShipmentForViewer(shipment, req.user, offers),
        offersCount: shipmentOffers.length,
        lowestOffer,
        hasMyOffer: !!myOffer,
        myOfferAmount: myOffer ? toNumber(myOffer.amount, null) : null,
        myOfferStatus: myOffer ? myOffer.status : null,
        myOfferId: myOffer ? myOffer.id : null,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Greška /shipments GET:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/my-shipments', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({ message: 'Samo naručitelj može vidjeti svoje objave.' });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const myShipments = shipments
      .filter((s) => Number(s.senderId) === Number(req.user.id))
      .map((shipment) => {
        const shipmentOffers = offers.filter((o) => Number(o.shipmentId) === Number(shipment.id));
        const validOffers = shipmentOffers.filter((o) => o.status !== 'rejected');
        const lowestOffer =
          validOffers.length > 0
            ? Math.min(...validOffers.map((o) => toNumber(o.amount, 0)))
            : null;

        return {
          ...shipment,
          offersCount: validOffers.length,
          lowestOffer,
        };
      });

    res.json(myShipments);
  } catch (error) {
    console.error('Greška /my-shipments:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/shipments/:id', authMiddleware, (req, res) => {
  try {
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const shipment = shipments.find((s) => Number(s.id) === Number(req.params.id));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    const sanitized = sanitizeShipmentForViewer(shipment, req.user, offers);

    res.json(sanitized);
  } catch (error) {
    console.error('Greška /shipments/:id:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/shipments/:id/bid-history', authMiddleware, (req, res) => {
  try {
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);
    const users = readJson(usersFile);

    const shipment = shipments.find((s) => Number(s.id) === Number(req.params.id));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    const isSenderOwner =
      req.user.role === 'sender' && Number(shipment.senderId) === Number(req.user.id);

    const isCarrier = isCarrierRole(req.user.role);

    if (!isSenderOwner && !isCarrier) {
      return res.status(403).json({ message: 'Nemate pristup tijeku licitacije.' });
    }

    const bidHistory = buildBidHistoryForViewer({
      shipment,
      offers,
      users,
      viewer: req.user,
    });

    const activeOffers = offers.filter(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        o.status !== 'rejected'
    );

    const lowestOffer =
      activeOffers.length > 0
        ? Math.min(...activeOffers.map((o) => toNumber(o.amount, 0)))
        : null;

    const myOffer = activeOffers.find(
      (o) => Number(o.carrierId) === Number(req.user.id)
    );

    res.json({
      shipmentId: shipment.id,
      shipmentStatus: shipment.status,
      offersCount: activeOffers.length,
      lowestOffer,
      myOfferAmount: myOffer ? toNumber(myOffer.amount, null) : null,
      myOfferStatus: myOffer ? myOffer.status : null,
      myOfferId: myOffer ? myOffer.id : null,
      bidHistory,
    });
  } catch (error) {
    console.error('Greška /shipments/:id/bid-history:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= OFFERS =================

app.post('/offers', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({ message: 'Samo prijevoznik može slati ponude.' });
    }

    const offers = readJson(offersFile);
    const shipments = readJson(shipmentsFile);

    const shipmentId = req.body.shipmentId || req.body.shipment_id;
    const amount = req.body.amount || req.body.price;

    if (!shipmentId || amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ message: 'shipmentId i amount su obavezni.' });
    }

    const shipment = shipments.find((s) => Number(s.id) === Number(shipmentId));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    if (shipment.status !== 'aktivan') {
      return res.status(400).json({ message: 'Na ovaj teret više nije moguće slati ponude.' });
    }

    const existingAcceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        (o.status === 'accepted' || o.status === 'prihvaceno' || o.status === 'prihvaćeno')
    );

    if (existingAcceptedOffer) {
      return res.status(400).json({ message: 'Ponuda je već prihvaćena za ovaj teret.' });
    }

    const existingMyOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        Number(o.carrierId) === Number(req.user.id) &&
        o.status !== 'rejected'
    );

    const numericAmount = toNumber(amount);

    if (existingMyOffer) {
      if (numericAmount > toNumber(existingMyOffer.amount)) {
        return res.status(400).json({
          message: 'Nova ponuda mora biti niža ili jednaka vašoj prethodnoj ponudi.',
        });
      }

      if (toNumber(existingMyOffer.amount) - numericAmount < 5) {
        return res.status(400).json({
          message: 'Minimalno sniženje ponude je 5 €.',
        });
      }

      if (!Array.isArray(existingMyOffer.bidHistory)) {
        existingMyOffer.bidHistory = [
          {
            amount: toNumber(existingMyOffer.amount, 0),
            createdAt: existingMyOffer.createdAt || existingMyOffer.updatedAt || nowIso(),
          },
        ];
      }

      existingMyOffer.amount = numericAmount;
      existingMyOffer.updatedAt = nowIso();

      existingMyOffer.bidHistory.push({
        amount: numericAmount,
        createdAt: existingMyOffer.updatedAt,
      });

      writeJson(offersFile, offers);

      addNotification({
        userId: shipment.senderId,
        type: 'offer_updated',
        title: 'Ponuda ažurirana',
        message: 'Prijevoznik je ažurirao svoju ponudu za vaš teret.',
        shipmentId: shipment.id,
        offerId: existingMyOffer.id,
        createdBy: req.user.id,
      });

      addOutbidNotifications({
        offers,
        shipment,
        currentCarrierId: req.user.id,
        currentOfferId: existingMyOffer.id,
      });

      return res.json({
        message: 'Ponuda je uspješno ažurirana.',
        offer: existingMyOffer,
      });
    }

    const createdAt = nowIso();

    const newOffer = {
      id: getNextId(offers),
      shipmentId: Number(shipment.id),
      senderId: Number(shipment.senderId),
      carrierId: Number(req.user.id),
      amount: numericAmount,
      status: 'active',
      contactUnlocked: false,
      commissionPaid: false,
      bidHistory: [
        {
          amount: numericAmount,
          createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    };

    offers.unshift(newOffer);
    writeJson(offersFile, offers);

    addNotification({
      userId: shipment.senderId,
      type: 'offer_created',
      title: 'Nova ponuda',
      message: 'Zaprimili ste novu ponudu za vaš teret.',
      shipmentId: shipment.id,
      offerId: newOffer.id,
      createdBy: req.user.id,
    });

    addOutbidNotifications({
      offers,
      shipment,
      currentCarrierId: req.user.id,
      currentOfferId: newOffer.id,
    });

    res.status(201).json({
      message: 'Ponuda je uspješno poslana.',
      offer: newOffer,
    });
  } catch (error) {
    console.error('Greška /offers POST:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/my-offers', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({ message: 'Samo prijevoznik može vidjeti svoje ponude.' });
    }

    const offers = readJson(offersFile);
    const shipments = readJson(shipmentsFile);

    const myOffers = offers
      .filter((o) => Number(o.carrierId) === Number(req.user.id))
      .map((offer) => {
        const shipment = shipments.find((s) => Number(s.id) === Number(offer.shipmentId));
        return {
          ...offer,
          shipment: shipment || null,
        };
      });

    res.json(myOffers);
  } catch (error) {
    console.error('Greška /my-offers:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.get('/shipments/:id/offers', authMiddleware, (req, res) => {
  try {
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);
    const users = readJson(usersFile);

    const shipment = shipments.find((s) => Number(s.id) === Number(req.params.id));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Nemate pristup ponudama za ovaj teret.' });
    }

    const shipmentOffers = offers
      .filter((o) => Number(o.shipmentId) === Number(shipment.id))
      .map((offer) => {
        const carrier = users.find((u) => Number(u.id) === Number(offer.carrierId));
        return {
          ...offer,
          carrier: carrier
            ? {
                id: carrier.id,
                fullName: carrier.fullName,
                companyName: carrier.companyName,
                email: carrier.email,
                phone: carrier.phone,
              }
            : null,
        };
      });

    res.json(shipmentOffers);
  } catch (error) {
    console.error('Greška /shipments/:id/offers:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.post('/offers/:id/accept', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({ message: 'Samo naručitelj može prihvatiti ponudu.' });
    }

    const offers = readJson(offersFile);
    const shipments = readJson(shipmentsFile);

    const offer = offers.find((o) => Number(o.id) === Number(req.params.id));
    if (!offer) {
      return res.status(404).json({ message: 'Ponuda nije pronađena.' });
    }

    const shipment = shipments.find((s) => Number(s.id) === Number(offer.shipmentId));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Nemate pravo prihvatiti ovu ponudu.' });
    }

    if (shipment.status !== 'aktivan') {
      return res.status(400).json({ message: 'Ovaj teret više nije aktivan.' });
    }

    offer.status = 'accepted';
    offer.updatedAt = nowIso();

    offers.forEach((o) => {
      if (
        Number(o.shipmentId) === Number(shipment.id) &&
        Number(o.id) !== Number(offer.id)
      ) {
        o.status = 'rejected';
        o.updatedAt = nowIso();
      }
    });

    shipment.status = 'prihvaceno';
    shipment.acceptedOfferId = offer.id;
    shipment.acceptedCarrierId = offer.carrierId;
    shipment.updatedAt = nowIso();

    writeJson(offersFile, offers);
    writeJson(shipmentsFile, shipments);

    addNotification({
      userId: offer.carrierId,
      type: 'offer_accepted',
      title: 'Ponuda prihvaćena',
      message:
        'Vaša ponuda je prihvaćena. Za nastavak morate imati aktiviran Stripe račun i platiti proviziju kako biste otključali kontakt.',
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: req.user.id,
    });

    res.json({
      message: 'Ponuda je uspješno prihvaćena.',
      offer,
      shipment,
    });
  } catch (error) {
    console.error('Greška /offers/:id/accept:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= CONTACT UNLOCK / COMMISSION =================

app.post('/offers/:id/unlock-contact', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({ message: 'Samo prijevoznik može otključati kontakt.' });
    }

    const offers = readJson(offersFile);
    const shipments = readJson(shipmentsFile);

    const offer = offers.find((o) => Number(o.id) === Number(req.params.id));
    if (!offer) {
      return res.status(404).json({ message: 'Ponuda nije pronađena.' });
    }

    if (Number(offer.carrierId) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Nemate pravo otključati ovaj kontakt.' });
    }

    const shipment = shipments.find((s) => Number(s.id) === Number(offer.shipmentId));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    if (offer.status !== 'accepted') {
      return res.status(400).json({
        message: 'Kontakt je moguće otključati tek nakon što ponuda bude prihvaćena.',
      });
    }

    if (offer.contactUnlocked === true) {
      return res.json({
        message: 'Kontakt je već otključan.',
        contactUnlocked: true,
        offer,
      });
    }

    offer.commissionPaid = true;
    offer.contactUnlocked = true;
    offer.updatedAt = nowIso();

    shipment.contactUnlocked = true;
    shipment.updatedAt = nowIso();

    writeJson(offersFile, offers);
    writeJson(shipmentsFile, shipments);

    addNotification({
      userId: offer.carrierId,
      type: 'contact_unlocked',
      title: 'Kontakt otključan',
      message: 'Kontakt otključan. Možete započeti dogovor u vezi realizacije prijevoza.',
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: req.user.id,
      meta: {
        commissionPaid: true,
      },
    });

    addNotification({
      userId: shipment.senderId,
      type: 'contact_unlocked',
      title: 'Kontakt otključan prijevozniku',
      message:
        'Prihvaćeni prijevoznik sada vidi vaše podatke i može vas kontaktirati u vezi dogovora.',
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: req.user.id,
      meta: {
        carrierId: offer.carrierId,
      },
    });

    res.json({
      message: 'Kontakt je uspješno otključan.',
      contactUnlocked: true,
      offer,
    });
  } catch (error) {
    console.error('Greška /offers/:id/unlock-contact:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= DELIVERY CONFIRM =================

app.post('/shipments/:id/confirm-delivery', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({ message: 'Samo naručitelj može potvrditi isporuku.' });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const shipment = shipments.find((s) => Number(s.id) === Number(req.params.id));
    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Nemate pravo potvrditi ovu isporuku.' });
    }

    shipment.status = 'zavrseno';
    shipment.updatedAt = nowIso();

    writeJson(shipmentsFile, shipments);

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        o.status === 'accepted'
    );

    if (acceptedOffer) {
      addNotification({
        userId: acceptedOffer.carrierId,
        type: 'delivery_confirmed',
        title: 'Isporuka potvrđena',
        message: 'Naručitelj je potvrdio da je prijevoz uspješno završen.',
        shipmentId: shipment.id,
        offerId: acceptedOffer.id,
        createdBy: req.user.id,
      });
    }

    res.json({
      message: 'Isporuka je potvrđena.',
      shipment,
    });
  } catch (error) {
    console.error('Greška /shipments/:id/confirm-delivery:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= NOTIFICATIONS =================

app.get('/notifications', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const mine = notifications.filter(
      (n) => Number(n.userId) === Number(req.user.id)
    );

    res.json(mine);
  } catch (error) {
    console.error('Greška /notifications:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.post('/notifications/:id/read', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const notification = notifications.find(
      (n) =>
        Number(n.id) === Number(req.params.id) &&
        Number(n.userId) === Number(req.user.id)
    );

    if (!notification) {
      return res.status(404).json({ message: 'Obavijest nije pronađena.' });
    }

    notification.isRead = true;
    writeJson(notificationsFile, notifications);

    res.json({
      message: 'Obavijest označena kao pročitana.',
      notification,
    });
  } catch (error) {
    console.error('Greška /notifications/:id/read:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= START =================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TeReT backend radi na portu ${PORT}`);
});