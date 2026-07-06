

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'TeReT_secret_key';
let firebaseReady = false;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendVerificationEmail(email, verificationUrl) {
  try {
    console.log('ŠALJEM EMAIL NA:', email);
    console.log('APP_URL:', APP_URL);

    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log('MAIL_USER ili MAIL_PASS nisu postavljeni.');
      return;
    }

    const result = await mailTransporter.sendMail({
      from: `"TeReT" <${process.env.MAIL_USER}>`,
      to: email,
      subject: 'Potvrdite svoju email adresu - TeReT',
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Dobrodošli u TeReT</h2>
          <p>Kliknite za potvrdu računa:</p>
          <a href="${verificationUrl}">
            Potvrdi račun
          </a>
        </div>
      `,
    });

    console.log('EMAIL POSLAN:', result.messageId);
  } catch (error) {
    console.error('GREŠKA SLANJA EMAILA:', error);
    throw error;
  }
}
try {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  firebaseReady = true;

  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.log('⚠️ Firebase init error:', error.message);
}
app.use(cors());
app.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    if (!stripe) {
      return res.status(500).send('Stripe nije konfiguriran.');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).send('STRIPE_WEBHOOK_SECRET nije postavljen.');
    }

    const signature = req.headers['stripe-signature'];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (error) {
      console.error('Stripe webhook signature error:', error.message);
      return res.status(400).send(`Webhook error: ${error.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        const shipmentId = Number(session.metadata?.shipmentId);
        const carrierId = Number(session.metadata?.carrierId);

        const offers = readJson(offersFile);
        const shipments = readJson(shipmentsFile);

        const shipment = shipments.find(
          (s) => Number(s.id) === shipmentId
        );

        const offer = offers.find(
          (o) =>
            Number(o.shipmentId) === shipmentId &&
            Number(o.carrierId) === carrierId &&
            (
              o.status === 'accepted' ||
              o.status === 'prihvaceno' ||
              o.status === 'prihvaćeno'
            )
        );

        if (!shipment || !offer) {
          console.log('Stripe webhook: shipment ili offer nisu pronađeni.', {
            shipmentId,
            carrierId,
          });

          return res.json({ received: true });
        }

        if (offer.contactUnlocked === true) {
          return res.json({ received: true });
        }

        offer.commissionPaid = true;
        offer.contactUnlocked = true;
        offer.stripeSessionId = session.id;
        offer.stripePaymentIntentId = session.payment_intent || null;
        offer.updatedAt = nowIso();

        shipment.contactUnlocked = true;
        shipment.updatedAt = nowIso();

        writeJson(offersFile, offers);
        writeJson(shipmentsFile, shipments);

        addNotification({
          userId: offer.carrierId,
          type: 'contact_unlocked',
          title: 'Kontakt je otključan',
          message: 'Sada možete pristupiti dogovoru.',
          shipmentId: shipment.id,
          offerId: offer.id,
          createdBy: offer.carrierId,
          meta: {
            commissionPaid: true,
            stripeSessionId: session.id,
          },
        });

        addNotification({
          userId: shipment.senderId,
          type: 'carrier_contact_unlocked',
          title: 'TeReT vas je povezao',
          message:
            'Prihvaćeni prijevoznik sada vidi vaše podatke i može vas kontaktirati.',
          shipmentId: shipment.id,
          offerId: offer.id,
          createdBy: offer.carrierId,
          meta: {
            carrierId: offer.carrierId,
            stripeSessionId: session.id,
          },
        });

        sendPushNotificationToUser(
          offer.carrierId,
          'Kontakt je otključan',
          'Sada možete pristupiti dogovoru.',
          {
            type: 'contact_unlocked',
            shipmentId: shipment.id,
            offerId: offer.id,
          }
        );

        sendPushNotificationToUser(
          shipment.senderId,
          'TeReT vas je povezao',
          'Prihvaćeni prijevoznik sada vidi vaše podatke i može vas kontaktirati.',
          {
            type: 'carrier_contact_unlocked',
            shipmentId: shipment.id,
            offerId: offer.id,
          }
        );
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Stripe webhook obrada greška:', error);
      res.status(500).send('Webhook obrada nije uspjela.');
    }
  }
);
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.post('/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    const { shipmentId } = req.body;
   if (!stripe) {
     return res.status(500).json({
       message: 'Stripe nije konfiguriran.',
     });
   }

   if (!shipmentId) {
     return res.status(400).json({
       message: 'shipmentId je obavezan.',
     });
   }
const offers = readJson(offersFile);

const acceptedOffer = offers.find(
  (o) =>
    Number(o.shipmentId) === Number(shipmentId) &&
    Number(o.carrierId) === Number(req.user.id) &&
    (
      o.status === 'accepted' ||
      o.status === 'prihvaceno' ||
      o.status === 'prihvaćeno'
    )
);

if (!acceptedOffer) {
  return res.status(404).json({
    message: 'Prihvaćena ponuda nije pronađena.',
  });
}
if (
  acceptedOffer.commissionPaid === true ||
  acceptedOffer.contactUnlocked === true
) {
  return res.status(400).json({
    message: 'Provizija je već plaćena i kontakt je već otključan.',
  });
}
const acceptedAmount = Number(acceptedOffer.amount);

const calculatedCommission = acceptedAmount * 0.05;

const commissionAmount = Math.round(
  Math.max(calculatedCommission, 5) * 100
);

if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
  return res.status(400).json({
    message: 'Neispravan iznos provizije.',
  });
}
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'TeReT provizija',
            },
           unit_amount: commissionAmount,
          },
          quantity: 1,
        },
      ],
     success_url: `${APP_URL}/payment-success?shipmentId=${shipmentId}`,
      cancel_url: `${APP_URL}/payment-cancel`,
      metadata: {
        carrierId: req.user.id,
        shipmentId,
      },
    });

    res.json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'Greška pri kreiranju Stripe naplate.',
    });
  }
});
// ================= PATHS =================

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const shipmentsFile = path.join(dataDir, 'shipments.json');
const offersFile = path.join(dataDir, 'offers.json');
const notificationsFile = path.join(dataDir, 'notifications.json');
const ratingsFile = path.join(dataDir, 'ratings.json');
const uploadsDir = path.join(__dirname, 'uploads');
const shipmentUploadsDir = path.join(uploadsDir, 'shipments');

if (!fs.existsSync(shipmentUploadsDir)) {
  fs.mkdirSync(shipmentUploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));
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
ensureDirAndFile(ratingsFile, []);

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
function isVisibleFinishedShipment(shipment) {
  const status = normalizeString(shipment.status).toLowerCase();

  const isCompleted =
    status === 'completed' ||
    status === 'zavrseno' ||
    status === 'završeno';

  if (!isCompleted) return true;

  const completedAt =
    shipment.completedAt ||
    shipment.deliveryConfirmedAt ||
    shipment.updatedAt;

  if (!completedAt) return false;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  return new Date(completedAt).getTime() >= oneDayAgo;
}
function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}
function normalizeRegion(region) {
  const value = normalizeString(region).toLowerCase();

  if (value === 'eu') return 'EU';
  if (value === 'balkan') return 'BALKAN';
  if (value === 'uk') return 'UK';
  if (value === 'usa' || value === 'sad') return 'USA';
  if (value === 'canada' || value === 'kanada') return 'CANADA';
  if (value === 'australia_nz' || value === 'australija_nz') return 'AUSTRALIA_NZ';

  return 'Evropa';
}
function normalizeRole(role) {
  const value = normalizeString(role).toLowerCase();
  if (value === 'transporter') return 'carrier';
  return value;
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      ime: user.ime || user.fullName || '',
      naziv_tvrtke: user.naziv_tvrtke || user.companyName || '',
      emailVerified: user.emailVerified === true,
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
function saveShipmentImages(base64Images, shipmentId) {
  if (!Array.isArray(base64Images)) return [];

  return base64Images.slice(0, 5).map((image, index) => {
    let clean = String(image || '').trim();

    if (clean.startsWith('data:image')) {
      clean = clean.substring(clean.indexOf(',') + 1);
    }

    const filename =
      `shipment_${shipmentId}_${index + 1}_${Date.now()}.jpg`;

    const filePath = path.join(
      shipmentUploadsDir,
      filename,
    );

    fs.writeFileSync(
      filePath,
      Buffer.from(clean, 'base64'),
    );

    return `/uploads/shipments/${filename}`;
  });
}
const NOTIFICATION_RETENTION_DAYS = 7;

function cleanupOldNotifications() {
  try {
    const notifications = readJson(notificationsFile);
    const cutoff =
      Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const freshNotifications = notifications.filter((n) => {
      if (!n.createdAt) return true;

      const createdTime = new Date(n.createdAt).getTime();
      if (Number.isNaN(createdTime)) return true;

      return createdTime >= cutoff;
    });

    if (freshNotifications.length !== notifications.length) {
      writeJson(notificationsFile, freshNotifications);

      console.log(
        `Cleanup: obrisano ${
          notifications.length - freshNotifications.length
        } starih notifikacija.`
      );
    }
  } catch (error) {
    console.log('Cleanup notifikacija nije uspio:', error.message);
  }
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
async function sendPushNotificationToUser(
  userId,
  title,
  body,
  data = {}
) {
  if (!firebaseReady) {
    console.log('FIREBASE NIJE SPREMAN');
    return;
  }

  try {
    const users = readJson(usersFile);

    const user = users.find(
      (u) => Number(u.id) === Number(userId)
    );

    console.log('PUSH USER:', userId);

    if (!user) {
      console.log('USER NIJE PRONAĐEN');
      return;
    }

    console.log('FCM TOKEN:', user.fcmToken);

    if (!user.fcmToken) {
      console.log('KORISNIK NEMA FCM TOKEN');
      return;
    }

    await admin.messaging().send({
      token: user.fcmToken,
      notification: {
        title,
        body,
      },
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          String(value),
        ])
      ),
    });

    console.log('✅ Push poslan korisniku:', userId);
  } catch (error) {
    console.log('FCM send error:', error);
  }
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
  const users = readJson(usersFile);
  const carrierUser = users.find((u) => Number(u.id) === carrierId);

  if (!carrierUser || !isCarrierRole(carrierUser.role)) {
  return;
}
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
    sendPushNotificationToUser(
      carrierId,
      'Ponuda više nije najniža',
      'Vaša ponuda više nije najniža. Pošaljite novu ponudu kako biste ostali konkurentni.',
      {
        type: 'offer_outbid',
        shipmentId: shipment.id,
        offerId: offer.id,
        lowestAmount,
        currentOfferId,
      }
    );
  });
}

function addNewShipmentNotifications({ users, shipment, createdBy }) {
  const carriers = users.filter((u) => normalizeRole(u.role) === 'carrier');

  console.log('BROJ PRIJEVOZNIKA ZA OBAVIJEST:', carriers.length);
  console.log(
    'PRIJEVOZNICI:',
    carriers.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      emailVerified: u.emailVerified,
    }))
  );

  carriers.forEach((carrier) => {
    addNotification({
      userId: carrier.id,
      type: 'new_shipment',
      title: 'Novi teret',
      message: `Objavljen je novi teret: ${shipment.mjesto_utovara} → ${shipment.mjesto_istovara}`,
      shipmentId: shipment.id,
      createdBy,
      meta: {
        naziv_tereta: shipment.naziv_tereta,
        mjesto_utovara: shipment.mjesto_utovara,
        mjesto_istovara: shipment.mjesto_istovara,
        rok_utovara: shipment.rok_utovara,
      },
    });

    sendPushNotificationToUser(
      carrier.id,
      'Novi teret',
      `${shipment.mjesto_utovara} → ${shipment.mjesto_istovara}`,
      {
        type: 'new_shipment',
        shipmentId: shipment.id,
      }
    );
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

  if (!isCarrierRole(viewer.role)) {
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
  return normalizeRole(role) === 'carrier';
}

function getUserRatingSummary(userId, ratings) {
  const userRatings = ratings.filter(
    (r) => Number(r.ratedUserId) === Number(userId)
  );

  if (userRatings.length === 0) {
    return {
      averageRating: null,
      ratingsCount: 0,
    };
  }

  const averageRating = (
    userRatings.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
    userRatings.length
  ).toFixed(1);

  return {
    averageRating,
    ratingsCount: userRatings.length,
  };
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

function buildBidHistoryForViewer({ shipment, offers, users, viewer, ratings = [] }) {
  const shipmentOffers = offers.filter(
    (o) => Number(o.shipmentId) === Number(shipment.id)
  );

  const allBids = [];

  shipmentOffers.forEach((offer) => {
    const history = getOfferBidHistory(offer);
    const carrier = users.find((u) => Number(u.id) === Number(offer.carrierId));
    const carrierRating = getUserRatingSummary(offer.carrierId, ratings);
    const isMyOffer = Number(offer.carrierId) === Number(viewer.id);
    const isSenderOwner =
      viewer.role === 'sender' && Number(shipment.senderId) === Number(viewer.id);

    history.forEach((historyItem, index) => {
      const isLastBid = index === history.length - 1;

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
        carrierAverageRating: carrierRating.averageRating,
        carrierRatingsCount: carrierRating.ratingsCount,
        amount: toNumber(historyItem.amount, 0),
        status: offer.status,
        isMyOffer,
        isAccepted: offer.status === 'accepted' && isLastBid,
        isRejected: offer.status === 'rejected' && isLastBid,
        bidNumber: index + 1,
        createdAt:
          historyItem.createdAt ||
          offer.createdAt ||
          offer.updatedAt ||
          nowIso(),
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

// ================= CLEANUP =================

const UNVERIFIED_ACCOUNT_RETENTION_HOURS = 48;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function cleanupOldNotifications() {
  const notifications = readJson(notificationsFile);

  const cutoffTime =
    Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const filteredNotifications = notifications.filter((notification) => {
    const createdAtTime = new Date(notification.createdAt || 0).getTime();

    if (!Number.isFinite(createdAtTime)) {
      return true;
    }

    return createdAtTime >= cutoffTime;
  });

  if (filteredNotifications.length !== notifications.length) {
    writeJson(notificationsFile, filteredNotifications);

    console.log(
      `Cleanup: obrisano ${
        notifications.length - filteredNotifications.length
      } starih obavijesti.`
    );
  }
}

function cleanupExpiredShipments() {
  const shipments = readJson(shipmentsFile);
  let changed = false;

  shipments.forEach((shipment) => {
    if (shipment.status !== 'aktivan') return;
    if (!shipment.licitacija_zavrsava_at) return;

    const endTime = new Date(shipment.licitacija_zavrsava_at).getTime();

    if (!Number.isFinite(endTime)) return;

    if (endTime <= Date.now()) {
      shipment.status = 'licitacija_zavrsena';
      shipment.updatedAt = nowIso();
      changed = true;
    }
  });

  if (changed) {
    writeJson(shipmentsFile, shipments);
    console.log('Cleanup: istekle licitacije označene kao završene.');
  }
}

function runCleanup() {
  cleanupOldNotifications();
  cleanupExpiredShipments();
  cleanupUnverifiedUsers();
}
function cleanupUnverifiedUsers() {
  const users = readJson(usersFile);

  const cutoff =
    Date.now() -
    UNVERIFIED_ACCOUNT_RETENTION_HOURS * 60 * 60 * 1000;

  const filteredUsers = users.filter((user) => {
    if (user.emailVerified === true) {
      return true;
    }

    const createdTime = new Date(user.createdAt || 0).getTime();

    if (!Number.isFinite(createdTime)) {
      return false;
    }

    return createdTime >= cutoff;
  });

  if (filteredUsers.length !== users.length) {
    writeJson(usersFile, filteredUsers);

    console.log(
      `Cleanup: obrisano ${
        users.length - filteredUsers.length
      } nepotvrđenih računa.`
    );
  }
}
// ================= ROOT =================

app.get('/', (req, res) => {
  res.json({ message: 'TeReT backend radi.' });
});
app.get('/payment-success', (req, res) => {
  const shipmentId = req.query.shipmentId;

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Plaćanje uspješno</title>

        <script>
          window.location.replace(
            "teret://payment-success?shipmentId=${shipmentId}"
          );

          setTimeout(() => {
            document.getElementById("openApp").style.display = "inline-block";
          }, 2000);
        </script>
      </head>

      <body style="font-family:Arial;text-align:center;padding:40px;">
        <h2>✅ Plaćanje uspješno</h2>
        <p>Vraćamo vas u aplikaciju TeReT...</p>

        <a
          id="openApp"
          href="teret://payment-success?shipmentId=${shipmentId}"
          style="display:none;
                 padding:12px 20px;
                 background:#2563eb;
                 color:white;
                 text-decoration:none;
                 border-radius:8px;">
          Otvori TeReT
        </a>
      </body>
    </html>
  `);
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
    const role = normalizeRole(req.body.role);
    const country = normalizeString(req.body.country);

    let region = 'Evropa';

    if (country === 'Ujedinjeno Kraljevstvo') {
      region = 'UK';
    } else if (country === 'SAD') {
      region = 'USA';
    } else if (country === 'Kanada') {
      region = 'CANADA';
    } else if (country === 'Australija') {
      region = 'AUSTRALIA_NZ';
    }
    if (!fullName || !email || !phone || !password || !role) {
      return res.status(400).json({
        message: 'fullName, email, phone, password i role su obavezni.',
      });
    }

    if (!['sender', 'carrier'].includes(role)) {
      return res.status(400).json({ message: 'Neispravna uloga korisnika.' });
    }

    const existingUser = users.find((u) => normalizeString(u.email).toLowerCase() === email);
    if (existingUser) {
      return res.status(400).json({ message: 'Korisnik s tim emailom već postoji.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = generateVerificationToken();

    const newUser = {
      id: getNextId(users),
      fullName,
      companyName,
      email,
      phone,
      country,
      region,
      password: hashedPassword,
      role,
      emailVerified: false,
      verificationToken,
      verifiedAt: null,
      createdAt: nowIso(),
    };

      users.push(newUser);
      writeJson(usersFile, users);

      const verificationUrl = `${APP_URL}/verify-email/${verificationToken}`;

      await sendVerificationEmail(email, verificationUrl);

      res.status(201).json({
        message:
          'Registracija uspješna. Poslali smo vam email za potvrdu računa.',

        user: {
          id: newUser.id,
          fullName: newUser.fullName,
          companyName: newUser.companyName,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          emailVerified: newUser.emailVerified,
        },
      });
    } catch (error) {
      console.error('Greška /register:', error);
      res.status(500).json({ message: 'Greška na serveru.' });
    }
  });

app.get('/verify-email/:token', (req, res) => {
  try {
    const users = readJson(usersFile);
    const token = normalizeString(req.params.token);

    const user = users.find((u) => normalizeString(u.verificationToken) === token);

    if (!user) {
      return res.status(400).json({
        message: 'Neispravan ili istekao link za potvrdu email adrese.',
      });
    }

    user.emailVerified = true;
    user.verificationToken = null;
    user.verifiedAt = nowIso();

    writeJson(usersFile, users);

    res.send(`
      <!DOCTYPE html>
      <html lang="hr">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>TeReT - račun potvrđen</title>
      </head>
      <body style="font-family: Arial, sans-serif; background:#f5f7fb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
        <div style="background:white; padding:28px; border-radius:16px; max-width:420px; text-align:center; box-shadow:0 4px 16px rgba(0,0,0,0.08);">
          <h2 style="color:#2e7d32;">Račun je potvrđen</h2>
          <p>Vaša email adresa je uspješno potvrđena.</p>
          <p>Sada se možete prijaviti u aplikaciju TeReT.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Greška /verify-email:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});
app.post('/resend-verification-email', async (req, res) => {
  try {
    const users = readJson(usersFile);
    const email = normalizeString(req.body.email).toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: 'Email je obavezan.',
      });
    }

    const user = users.find(
      (u) => normalizeString(u.email).toLowerCase() === email
    );

    if (!user) {
      return res.status(404).json({
        message: 'Korisnik s tom email adresom nije pronađen.',
      });
    }

    if (user.emailVerified === true) {
      return res.json({
        message: 'Račun je već potvrđen. Možete se prijaviti.',
      });
    }

    const verificationToken = generateVerificationToken();

    user.verificationToken = verificationToken;
    user.verificationEmailSentAt = nowIso();

    writeJson(usersFile, users);

    const verificationUrl = `${APP_URL}/verify-email/${verificationToken}`;

    await sendVerificationEmail(email, verificationUrl);

    res.json({
      message:
        'Email za potvrdu je ponovno poslan. Provjerite inbox i spam.',
    });
  } catch (error) {
    console.error('Greška /resend-verification-email:', error);

    res.status(500).json({
      message: 'Greška na serveru.',
    });
  }
});
app.post('/login', async (req, res) => {
  try {
    console.log('LOGIN BODY:', req.body);

    const users = readJson(usersFile);
  console.log('BROJ KORISNIKA:', users.length);
  console.log(
  'EMAILOVI U BAZI:',
  users.map((u) => ({
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
  }))
);
    const email = normalizeString(req.body.email).toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email i password su obavezni.' });
    }

    const user = users.find((u) => normalizeString(u.email).toLowerCase() === email);
    console.log('LOGIN TRAŽI EMAIL:', email);
    console.log('LOGIN USER PRONAĐEN:', !!user);
    if (!user) {
      return res.status(401).json({ message: 'Pogrešan email ili lozinka.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Pogrešan email ili lozinka.' });
    }

    if (user.emailVerified !== true) {
      return res.status(403).json({
        message:
          'Račun nije potvrđen.',
      });
    }

    const token = createToken(user);

    res.json({
      message: 'Prijava uspješna.',
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        companyName: user.companyName || '',
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerified === true,
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
    companyName: user.companyName || '',
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified === true,
  });
});
// ================= FCM =================

app.post('/fcm-token', authMiddleware, (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({
        message: 'FCM token je obavezan.',
      });
    }

    const users = readJson(usersFile);

    const user = users.find(
      (u) => Number(u.id) === Number(req.user.id)
    );

    if (!user) {
      return res.status(404).json({
        message: 'Korisnik nije pronađen.',
      });
    }

    user.fcmToken = fcmToken;
    user.fcmTokenUpdatedAt = nowIso();

    writeJson(usersFile, users);

    res.json({
      success: true,
    });
  } catch (error) {
    console.error('Greška /fcm-token:', error);

    res.status(500).json({
      message: 'Greška na serveru.',
    });
  }
});
// ================= SHIPMENTS =================

app.put('/shipments/:id', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: 'Samo naručitelj može uređivati objavu.',
      });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);
    const shipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!shipment) {
      return res.status(404).json({
        message: 'Teret nije pronađen.',
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: 'Nemate pravo uređivati ovaj teret.',
      });
    }

    if (shipment.status !== 'aktivan') {
      return res.status(400).json({
        message: 'Objavu je moguće uređivati samo dok je aktivna.',
      });
    }

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        (o.status === 'accepted' ||
          o.status === 'prihvaceno' ||
          o.status === 'prihvaćeno')
    );

    if (acceptedOffer) {
      return res.status(400).json({
        message: 'Objavu nije moguće uređivati nakon prihvaćanja ponude.',
      });
    }

    shipment.naziv_tereta = normalizeString(req.body.naziv_tereta || shipment.naziv_tereta);
    shipment.opis_tereta = normalizeString(req.body.opis_tereta || shipment.opis_tereta);
    shipment.mjesto_utovara = normalizeString(req.body.mjesto_utovara || shipment.mjesto_utovara);
    shipment.mjesto_istovara = normalizeString(req.body.mjesto_istovara || shipment.mjesto_istovara);

    shipment.updatedAt = nowIso();

    writeJson(shipmentsFile, shipments);

    res.json({
      message: 'Objava je uspješno ažurirana.',
      shipment,
    });
  } catch (error) {
    console.error('Greška PUT /shipments/:id:', error);
    res.status(500).json({
      message: 'Greška na serveru.',
    });
  }
});

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

    const rokUtovara = normalizeString(req.body.rok_utovara || req.body.rokUtovara);

    const allowedRokUtovara = ['24 sata', '48 sati', '72 sata+', 'Po dogovoru'];
    const trajanjeLicitacije =
      normalizeString(req.body.trajanje_licitacije) || '24 sata';

    const rokPreuzimanja =
      normalizeString(req.body.rok_preuzimanja) || '24 sata';

    let satiLicitacije = 24;

    if (trajanjeLicitacije === '6 sati') {
      satiLicitacije = 6;
    }

    if (trajanjeLicitacije === '12 sati') {
      satiLicitacije = 12;
    }

    if (trajanjeLicitacije === '24 sata') {
      satiLicitacije = 24;
    }

    if (trajanjeLicitacije === '12h') {
      satiLicitacije = 12;
    }

    const licitacijaZavrsavaAt = new Date(
      Date.now() + satiLicitacije * 60 * 60 * 1000
    ).toISOString();

    if (rokUtovara && !allowedRokUtovara.includes(rokUtovara)) {
      return res.status(400).json({
        message: 'Neispravan rok utovara.',
        allowedValues: allowedRokUtovara,
      });
    }
const newShipmentId = getNextId(shipments);

const rawShipmentImages =
  req.body.slike ||
  req.body.images ||
  req.body.imageUrls ||
  req.body.photos ||
  [];

const savedImages = saveShipmentImages(
  rawShipmentImages,
  newShipmentId
);
const textForContactCheck = `${req.body.naziv_tereta || req.body.title || ''} ${req.body.opis_tereta || req.body.description || ''}`;

const forbiddenContactPattern =
  /(\+?\d[\d\s\-\/().]{6,}\d)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(whatsapp|viber|telegram|signal|messenger|facebook|instagram|gmail|mail|email|e-mail|nazovi|zovi|javi se|kontaktiraj|kontakt|mobitel|telefon|broj)/i;

if (forbiddenContactPattern.test(textForContactCheck)) {
  return res.status(400).json({
    message:
      'Opis tereta ne smije sadržavati kontakt podatke, brojeve telefona, email adrese ili pozive na dogovor izvan aplikacije.',
  });
}
    const newShipment = {
      id: newShipmentId,
      senderId: Number(req.user.id),
      status: 'aktivan',
      naziv_tereta: req.body.naziv_tereta || req.body.title || '',
      opis_tereta: req.body.opis_tereta || req.body.description || '',
      mjesto_utovara: req.body.mjesto_utovara || '',
      adresa_utovara: req.body.adresa_utovara || '',
      mjesto_istovara: req.body.mjesto_istovara || '',
      adresa_istovara: req.body.adresa_istovara || '',
      datum_utovara: req.body.datum_utovara || '',
      rok_utovara: rokUtovara || '',
      rok_licitacije: req.body.rok_licitacije || '',
      trajanje_licitacije: trajanjeLicitacije,
      rok_preuzimanja: rokPreuzimanja,
      licitacija_zavrsava_at: licitacijaZavrsavaAt,
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
      slike: savedImages,
      phone: sender.phone || '',
      region: sender.region || 'Evropa',
      viewsCount: 0,
      viewedBy: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    shipments.unshift(newShipment);
    writeJson(shipmentsFile, shipments);

    addNewShipmentNotifications({
      users,
      shipment: newShipment,
      createdBy: req.user.id,
    });

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
    const users = readJson(usersFile);
    const ratings = readJson(ratingsFile);

    const userId = Number(req.user.id);
    const currentUser = users.find((u) => Number(u.id) === userId);
    const userRegion = currentUser?.region || 'Evropa';
    const offersByShipmentId = new Map();

    offers.forEach((offer) => {
      const shipmentId = Number(offer.shipmentId);
      if (!offersByShipmentId.has(shipmentId)) {
        offersByShipmentId.set(shipmentId, []);
      }
      offersByShipmentId.get(shipmentId).push(offer);
    });

    const usersById = new Map();
    users.forEach((user) => {
      usersById.set(Number(user.id), user);
    });

    const ratingsByUserId = new Map();

    ratings.forEach((rating) => {
      const ratedUserId = Number(rating.ratedUserId);
      if (!ratingsByUserId.has(ratedUserId)) {
        ratingsByUserId.set(ratedUserId, []);
      }
      ratingsByUserId.get(ratedUserId).push(rating);
    });

    const activeShipments = shipments.filter((shipment) => {
    const shipmentRegion = shipment.region || 'Evropa';

    if (shipmentRegion !== userRegion) {
      return false;
    }
      if (!isVisibleFinishedShipment(shipment)) {
      return false;
    }
      if (shipment.status === 'aktivan') return true;

      const shipmentOffers = offersByShipmentId.get(Number(shipment.id)) || [];

      const acceptedOffer = shipmentOffers.find(
        (offer) =>
          Number(offer.carrierId) === userId &&
          (offer.status === 'accepted' ||
            offer.status === 'prihvaceno' ||
            offer.status === 'prihvaćeno')
      );

      return !!acceptedOffer;
    });

    const result = activeShipments.map((shipment) => {
      const shipmentOffers = (offersByShipmentId.get(Number(shipment.id)) || [])
        .filter((offer) => offer.status !== 'rejected');

      const activeAmounts = shipmentOffers
        .map((offer) => toNumber(offer.amount, null))
        .filter((amount) => amount !== null && Number.isFinite(amount));

      const lowestOffer =
        activeAmounts.length > 0 ? Math.min(...activeAmounts) : null;

      const myOffer = shipmentOffers.find(
        (offer) => Number(offer.carrierId) === userId
      );

      const acceptedOffer = shipmentOffers.find(
        (offer) =>
          offer.status === 'accepted' ||
          offer.status === 'prihvaceno' ||
          offer.status === 'prihvaćeno'
      );
const senderUser = usersById.get(Number(shipment.senderId));

const senderRating = getUserRatingSummary(
  Number(shipment.senderId),
  ratings
);
      let ratedUserId = null;

      if (acceptedOffer) {
        ratedUserId =
          userId === Number(shipment.senderId)
            ? Number(acceptedOffer.carrierId)
            : Number(shipment.senderId);
      }

      const userRatings = ratedUserId
        ? ratingsByUserId.get(Number(ratedUserId)) || []
        : [];

      const averageRating =
        userRatings.length > 0
          ? (
              userRatings.reduce(
                (sum, rating) => sum + Number(rating.rating || 0),
                0
              ) / userRatings.length
            ).toFixed(1)
          : null;

      const ratedUser = ratedUserId
        ? usersById.get(Number(ratedUserId))
        : null;

      return {
        ...sanitizeShipmentForViewer(shipment, req.user, offers),
        slike: [],
        senderId: senderUser ? Number(senderUser.id) : Number(shipment.senderId),
        senderName: senderUser ? senderUser.fullName || 'Naručitelj' : 'Naručitelj',
        senderRatingAverage: senderRating.averageRating,
        senderRatingsCount: senderRating.ratingsCount,
        offersCount: shipmentOffers.length,
        lowestOffer,
        hasMyOffer: !!myOffer,
        myOfferAmount: myOffer ? toNumber(myOffer.amount, null) : null,
        myOfferStatus: myOffer ? myOffer.status : null,
        myOfferId: myOffer ? myOffer.id : null,
        myOfferIsLowest:
          myOffer && lowestOffer !== null
            ? toNumber(myOffer.amount, 0) === toNumber(lowestOffer, 0)
            : false,

        myOfferIsOutbid:
          myOffer && lowestOffer !== null
            ? toNumber(myOffer.amount, 0) > toNumber(lowestOffer, 0)
            : false,

        myOfferBadge:
          myOffer && lowestOffer !== null
            ? toNumber(myOffer.amount, 0) === toNumber(lowestOffer, 0)
              ? 'Najniža'
              : 'Nadmašena'
            : null,
        ratedUserId,
        ratedUserName: ratedUser ? ratedUser.fullName || '' : '',
        averageRating,
        ratingsCount: userRatings.length,
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
      return res.status(403).json({
        message: 'Samo naručitelj može vidjeti svoje objave.',
      });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const offersByShipmentId = new Map();

    offers.forEach((offer) => {
      const shipmentId = Number(offer.shipmentId);

      if (!offersByShipmentId.has(shipmentId)) {
        offersByShipmentId.set(shipmentId, []);
      }

      offersByShipmentId.get(shipmentId).push(offer);
    });

    const myShipments = shipments
      .filter((shipment) => {
        if (Number(shipment.senderId) !== Number(req.user.id)) {
          return false;
        }

        if (shipment.hiddenBySender === true) {
          return false;
        }

        return isVisibleFinishedShipment(shipment);
      })
      .map((shipment) => {
        const shipmentOffers =
          offersByShipmentId.get(Number(shipment.id)) || [];

        const validOffers = shipmentOffers.filter(
          (offer) => offer.status !== 'rejected'
        );

        const lowestOffer =
          validOffers.length > 0
            ? Math.min(...validOffers.map((offer) => toNumber(offer.amount, 0)))
            : null;

        return {
          ...shipment,
          slike: [],
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
app.put('/shipments/:id/hide', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: 'Samo naručitelj može ukloniti objavu iz povijesti.',
      });
    }

    const shipments = readJson(shipmentsFile);

    const shipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!shipment) {
      return res.status(404).json({
        message: 'Teret nije pronađen.',
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: 'Nemate pravo ukloniti ovu objavu.',
      });
    }

    const status = normalizeString(shipment.status).toLowerCase();

    const canHide =
      status === 'completed' ||
      status === 'zavrseno' ||
      status === 'završeno' ||
      status === 'licitacija_zavrsena' ||
      status === 'licitacija završena' ||
      status === 'expired' ||
      status === 'isteklo' ||
      status === 'withdrawn' ||
      status === 'povuceno' ||
      status === 'povučeno';

    if (!canHide) {
      return res.status(400).json({
        message: 'Samo završene, istekle ili povučene objave mogu se ukloniti iz povijesti.',
      });
    }

    shipment.hiddenBySender = true;
    shipment.hiddenBySenderAt = nowIso();
    shipment.updatedAt = nowIso();

    writeJson(shipmentsFile, shipments);

    res.json({
      message: 'Objava je uklonjena iz povijesti.',
    });
  } catch (error) {
    console.error('Greška PUT /shipments/:id/hide:', error);
    res.status(500).json({
      message: 'Greška na serveru.',
    });
  }
});
app.post('/shipments/:id/repost', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: 'Samo naručitelj može ponovno objaviti teret.',
      });
    }

    const shipments = readJson(shipmentsFile);
    const users = readJson(usersFile);
    const offers = readJson(offersFile);

    const oldShipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!oldShipment) {
      return res.status(404).json({
        message: 'Teret nije pronađen.',
      });
    }

    if (Number(oldShipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: 'Nemate pravo ponovno objaviti ovaj teret.',
      });
    }

    const oldOffers = offers.filter(
      (o) =>
        Number(o.shipmentId) === Number(oldShipment.id) &&
        o.status !== 'rejected'
    );

    if (oldOffers.length > 0) {
      return res.status(400).json({
        message:
          'Teret se može ponovno objaviti samo ako nije bilo ponuda.',
      });
    }

    const trajanjeLicitacije =
      oldShipment.trajanje_licitacije || '24 sata';

    let satiLicitacije = 24;

    if (trajanjeLicitacije === '6 sati') {
      satiLicitacije = 6;
    }

    if (
      trajanjeLicitacije === '12 sati' ||
      trajanjeLicitacije === '12h'
    ) {
      satiLicitacije = 12;
    }

    if (trajanjeLicitacije === '24 sata') {
      satiLicitacije = 24;
    }

    const licitacijaZavrsavaAt = new Date(
      Date.now() + satiLicitacije * 60 * 60 * 1000
    ).toISOString();

    const newShipment = {
      ...oldShipment,
      id: getNextId(shipments),
      status: 'aktivan',
      licitacija_zavrsava_at: licitacijaZavrsavaAt,
      viewsCount: 0,
      viewedBy: [],
      acceptedOfferId: null,
      acceptedCarrierId: null,
      contactUnlocked: false,
      repostedFromId: oldShipment.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    shipments.unshift(newShipment);

    writeJson(shipmentsFile, shipments);

    addNewShipmentNotifications({
      users,
      shipment: newShipment,
      createdBy: req.user.id,
    });

    res.status(201).json({
      message: 'Teret je ponovno objavljen.',
      shipment: newShipment,
    });
  } catch (error) {
    console.error('Greška /shipments/:id/repost:', error);

    res.status(500).json({
      message: 'Greška na serveru.',
    });
  }
});

app.get('/shipments/:id', authMiddleware, (req, res) => {
  try {
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);
    const users = readJson(usersFile);
    const ratings = readJson(ratingsFile);

    const shipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!shipment) {
      return res.status(404).json({ message: 'Teret nije pronađen.' });
    }
const shipmentOffers = offers.filter(
  (o) => Number(o.shipmentId) === Number(shipment.id)
);

const offersCount = shipmentOffers.length;
    if (isCarrierRole(req.user.role)) {
      if (!Array.isArray(shipment.viewedBy)) {
        shipment.viewedBy = [];
      }

      const alreadyViewed = shipment.viewedBy.includes(Number(req.user.id));

      if (!alreadyViewed) {
        shipment.viewedBy.push(Number(req.user.id));
        shipment.viewsCount = shipment.viewedBy.length;
        shipment.updatedAt = nowIso();
        writeJson(shipmentsFile, shipments);
      }
    }

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        (o.status === 'accepted' ||
          o.status === 'prihvaceno' ||
          o.status === 'prihvaćeno')
    );

    const senderUser = users.find(
      (u) => Number(u.id) === Number(shipment.senderId)
    );

    const acceptedCarrierId = acceptedOffer
      ? Number(acceptedOffer.carrierId)
      : null;

    const acceptedCarrier = acceptedCarrierId
      ? users.find((u) => Number(u.id) === acceptedCarrierId)
      : null;

    const acceptedCarrierRating = acceptedCarrierId
      ? getUserRatingSummary(acceptedCarrierId, ratings)
      : { averageRating: null, ratingsCount: 0 };
const senderRating = senderUser
  ? getUserRatingSummary(Number(senderUser.id), ratings)
  : { averageRating: null, ratingsCount: 0 };
    const isSenderOwner =
      req.user.role === 'sender' &&
      Number(req.user.id) === Number(shipment.senderId);

    const isAcceptedCarrier =
      acceptedOffer &&
      Number(req.user.id) === Number(acceptedOffer.carrierId);

    const statusText = normalizeString(shipment.status).toLowerCase();

    const isCompleted =
      statusText === 'zavrseno' ||
      statusText === 'završeno' ||
      statusText === 'completed';

    let ratingTargetUserId = null;
    let ratingTargetLabel = '';

    if (isSenderOwner && acceptedCarrierId) {
      ratingTargetUserId = acceptedCarrierId;
      ratingTargetLabel = 'prijevoznika';
    }

    if (isAcceptedCarrier) {
      ratingTargetUserId = Number(shipment.senderId);
      ratingTargetLabel = 'naručitelja';
    }

    const hasRated =
      ratingTargetUserId !== null &&
      ratings.some(
        (r) =>
          Number(r.shipmentId) === Number(shipment.id) &&
          Number(r.raterUserId) === Number(req.user.id) &&
          Number(r.ratedUserId) === Number(ratingTargetUserId)
      );

    const canRate =
      isCompleted &&
      ratingTargetUserId !== null &&
      hasRated !== true;

    const sanitized = sanitizeShipmentForViewer(shipment, req.user, offers);

    const acceptedPrice = acceptedOffer
      ? toNumber(acceptedOffer.amount, null)
      : null;

   const provizijaIznos =
     acceptedPrice !== null
       ? Math.max(acceptedPrice * 0.05, 5)
       : null;

    res.json({
      ...sanitized,
isAcceptedCarrier: isAcceptedCarrier === true,
      senderName: senderUser ? senderUser.fullName || '' : '',
senderId: senderUser ? Number(senderUser.id) : null,

senderRatingAverage: senderRating.averageRating,

senderRatingsCount: senderRating.ratingsCount,
      acceptedOffer: acceptedOffer
        ? {
            ...acceptedOffer,
            carrier: acceptedCarrier
              ? {
                  id: acceptedCarrier.id,
                  fullName: acceptedCarrier.fullName || '',
                  companyName: acceptedCarrier.companyName || '',
                  email: acceptedCarrier.email || '',
                  phone: acceptedCarrier.phone || '',
                  averageRating: acceptedCarrierRating.averageRating,
                  ratingsCount: acceptedCarrierRating.ratingsCount,
                }
              : null,
          }
        : null,

      acceptedCarrierId,
      acceptedCarrierName: acceptedCarrier
        ? acceptedCarrier.companyName ||
          acceptedCarrier.fullName ||
          acceptedCarrier.email ||
          ''
        : '',
      acceptedCarrierRatingAverage: acceptedCarrierRating.averageRating,
      acceptedCarrierRatingsCount: acceptedCarrierRating.ratingsCount,

      ratingTargetUserId,
      ratingTargetLabel,
      hasRated,
      canRate,

      averageRating: acceptedCarrierRating.averageRating,
      ratingsCount: acceptedCarrierRating.ratingsCount,

      viewsCount: Number(shipment.viewsCount) || 0,
      acceptedPrice,
      provizija_iznos: provizijaIznos,
offersCount,
broj_ponuda: offersCount,
      commissionPaid: acceptedOffer
        ? acceptedOffer.commissionPaid === true
        : false,

      kontakt_otkljucan: acceptedOffer
        ? acceptedOffer.contactUnlocked === true
        : false,

      acceptedTransporterMustPay:
        isAcceptedCarrier &&
        acceptedOffer.contactUnlocked !== true &&
    acceptedOffer.commissionPaid !== true,
    });
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
    const ratings = readJson(ratingsFile);

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
      ratings,
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
      myOfferIsLowest:
        myOffer && lowestOffer !== null
          ? toNumber(myOffer.amount, 0) === toNumber(lowestOffer, 0)
          : false,

      myOfferIsOutbid:
        myOffer && lowestOffer !== null
          ? toNumber(myOffer.amount, 0) > toNumber(lowestOffer, 0)
          : false,

      myOfferBadge:
        myOffer && lowestOffer !== null
          ? toNumber(myOffer.amount, 0) === toNumber(lowestOffer, 0)
            ? 'Najniža'
            : 'Nadmašena'
          : null,
      bidHistory,
    });
  } catch (error) {
    console.error('Greška /shipments/:id/bid-history:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= OFFERS =================
app.put('/offers/:id/hide', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({
        message: 'Samo prijevoznik može ukloniti ponudu iz povijesti.',
      });
    }

    const offers = readJson(offersFile);

    const offer = offers.find(
      (o) => Number(o.id) === Number(req.params.id)
    );

    if (!offer) {
      return res.status(404).json({
        message: 'Ponuda nije pronađena.',
      });
    }

    if (Number(offer.carrierId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: 'Nemate pristup ovoj ponudi.',
      });
    }

    offer.hiddenByCarrier = true;
    offer.hiddenByCarrierAt = nowIso();

    writeJson(offersFile, offers);

    res.json({
      message: 'Ponuda je uklonjena iz povijesti.',
    });
  } catch (error) {
    console.error('Greška /offers/:id/hide:', error);
    res.status(500).json({
      message: 'Greška na serveru.',
    });
      }
    });

app.post('/offers', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({ message: 'Samo prijevoznik može slati ponude.' });
    }

    const offers = readJson(offersFile);
    const shipments = readJson(shipmentsFile);
    const currency = req.body.currency || '€';
    const shipmentId = req.body.shipmentId || req.body.shipment_id;
    const amount = req.body.amount || req.body.price;
const offerMessage = normalizeString(
  req.body.message || req.body.poruka || ''
);

const forbiddenContactPattern =
  /(\+?\d[\d\s\-\/().]{6,}\d)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(whatsapp|viber|telegram|signal|messenger|facebook|instagram|gmail|mail|email|e-mail|nazovi|zovi|javi se|kontaktiraj|kontakt|mobitel|telefon|broj)/i;

if (forbiddenContactPattern.test(offerMessage)) {
  return res.status(400).json({
    message:
      'Poruka ponude ne smije sadržavati kontakt podatke, brojeve telefona, email adrese ili pozive na dogovor izvan aplikacije.',
  });
}
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

    if (shipment.licitacija_zavrsava_at) {
      const licitacijaZavrsena = new Date(shipment.licitacija_zavrsava_at).getTime() <= Date.now();

      if (licitacijaZavrsena) {
        shipment.status = 'licitacija_zavrsena';
        shipment.updatedAt = nowIso();

        writeJson(shipmentsFile, shipments);

        return res.status(400).json({
          message: 'Licitacija je završena. Nije više moguće slati ponude za ovaj teret.',
        });
      }
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
          message: `Minimalno sniženje ponude je 5 ${currency}.`,
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
      existingMyOffer.currency = currency;
      existingMyOffer.message = offerMessage;
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
      currency,
      message: offerMessage,
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
    sendPushNotificationToUser(
      shipment.senderId,
      'Nova ponuda',
      'Zaprimili ste novu ponudu za vaš teret.',
      {
        type: 'offer_created',
        shipmentId: shipment.id,
        offerId: newOffer.id,
      }
    );
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
     .filter((offer) => {
         if (Number(offer.carrierId) !== Number(req.user.id)) {
             return false;
         }

         // NOVO
         if (offer.hiddenByCarrier === true) {
             return false;
         }

         const shipment = shipments.find(
             (s) => Number(s.id) === Number(offer.shipmentId)
         );

         if (!shipment) {
             return false;
         }

         return isVisibleFinishedShipment(shipment);
     })
      .map((offer) => {


        const shipment = shipments.find((s) => Number(s.id) === Number(offer.shipmentId));
       const shipmentOffers = offers.filter(
         (o) =>
           Number(o.shipmentId) === Number(shipment?.id) &&
           o.status !== 'rejected'
       );

       const lowestOffer =
         shipmentOffers.length > 0
           ? Math.min(...shipmentOffers.map((o) => toNumber(o.amount, 0)))
           : null;

    return {
      ...offer,

      lowestOffer,

      myOfferIsLowest:
        lowestOffer !== null
          ? toNumber(offer.amount, 0) === toNumber(lowestOffer, 0)
          : false,

      myOfferIsOutbid:
        lowestOffer !== null
          ? toNumber(offer.amount, 0) > toNumber(lowestOffer, 0)
          : false,

      myOfferBadge:
        lowestOffer !== null
          ? toNumber(offer.amount, 0) === toNumber(lowestOffer, 0)
            ? 'Najniža'
            : 'Nadmašena'
          : null,

      shipment: shipment
        ? {
            ...shipment,
            offersCount: shipmentOffers.length,
            lowestOffer,
          }
        : null,

      offersCount: shipmentOffers.length,
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
    const ratings = readJson(ratingsFile);

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
        const carrierRating = getUserRatingSummary(offer.carrierId, ratings);

        return {
          ...offer,
          averageRating: carrierRating.averageRating,
          ratingsCount: carrierRating.ratingsCount,
          carrier: carrier
            ? {
                id: carrier.id,
                fullName: carrier.fullName,
                companyName: carrier.companyName || '',
                email: carrier.email,
                phone: carrier.phone,
                averageRating: carrierRating.averageRating,
                ratingsCount: carrierRating.ratingsCount,
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
    const shipments = readJson(shipmentsFile);
if (req.user.role !== 'sender') {
  return res.status(403).json({ message: 'Samo naručitelj može prihvatiti ponudu.' });
}

const offers = readJson(offersFile);
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

    const rejectedOffers = [];

    offers.forEach((o) => {
      if (
        Number(o.shipmentId) === Number(shipment.id) &&
        Number(o.id) !== Number(offer.id)
      ) {
        o.status = 'rejected';
        o.updatedAt = nowIso();
        rejectedOffers.push(o);
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
      title: 'Dobili ste posao',
      message:
        'Vaša ponuda je prihvaćena. Za nastavak aktivirajte  Stripe račun i platite naknadu kako biste otključali kontakt podatke.',
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: req.user.id,
    });

sendPushNotificationToUser(
  offer.carrierId,
  'Dobili ste posao',
  'Za nastavak aktivirajte Stripe račun i platite naknadu kako biste otključali kontakt podatke.',
  {
    type: 'offer_accepted',
    shipmentId: shipment.id,
    offerId: offer.id,
  }
);
rejectedOffers.forEach((rejectedOffer) => {
  addNotification({
    userId: rejectedOffer.carrierId,
    type: 'offer_rejected',
    title: 'Licitacija je završena',
    message: 'Drugi prijevoznik je odabran za ovaj prijevoz.',
    shipmentId: shipment.id,
    offerId: rejectedOffer.id,
    createdBy: req.user.id,
  });

  sendPushNotificationToUser(
    rejectedOffer.carrierId,
    'Licitacija je završena',
    'Drugi prijevoznik je odabran za ovaj prijevoz.',
    {
      type: 'offer_rejected',
      shipmentId: shipment.id,
      offerId: rejectedOffer.id,
    }
  );
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
app.post('/shipments/:id/pay-commission', authMiddleware, (req, res) => {
  return res.status(410).json({
    message: 'Plaćanje se sada izvršava isključivo preko Stripe Checkouta.',
  });
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
    shipment.completedAt = nowIso();
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
        title: 'Prijevoz dogovoren',
        message: 'Naručitelj je potvrdio da je prijevoz dogovoren.',
        shipmentId: shipment.id,
        offerId: acceptedOffer.id,
        createdBy: req.user.id,
      });
    }

    res.json({
      message: 'Prijevoz dogovoren.',
      shipment,
    });
  } catch (error) {
    console.error('Greška /shipments/:id/confirm-delivery:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

// ================= RATINGS =================

app.post('/ratings', authMiddleware, (req, res) => {
  try {
    const ratings = readJson(ratingsFile);
    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const shipmentId = Number(req.body.shipmentId);
    const rating = Number(req.body.rating);
    const comment = normalizeString(req.body.comment);

    if (!shipmentId || !rating) {
      return res.status(400).json({
        message: 'shipmentId i rating su obavezni.',
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        message: 'Ocjena mora biti između 1 i 5.',
      });
    }

    const shipment = shipments.find((s) => Number(s.id) === shipmentId);

    if (!shipment) {
      return res.status(404).json({
        message: 'Teret nije pronađen.',
      });
    }

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === shipmentId &&
        String(o.status).toLowerCase() === 'accepted'
    );

    if (!acceptedOffer) {
      return res.status(400).json({
        message: 'Nema prihvaćene ponude za ovaj prijevoz.',
      });
    }

    let ratedUserId;

    if (Number(req.user.id) === Number(shipment.senderId)) {
      ratedUserId = Number(acceptedOffer.carrierId);
    } else if (Number(req.user.id) === Number(acceptedOffer.carrierId)) {
      ratedUserId = Number(shipment.senderId);
    } else {
      return res.status(403).json({
        message: 'Nemate pravo ocijeniti ovaj prijevoz.',
      });
    }

    const existingRating = ratings.find(
      (r) =>
        Number(r.shipmentId) === shipmentId &&
        Number(r.raterUserId) === Number(req.user.id) &&
        Number(r.ratedUserId) === ratedUserId
    );

    if (existingRating) {
      return res.status(400).json({
        message: 'Već ste ocijenili ovog korisnika za ovaj prijevoz.',
      });
    }

    const newRating = {
      id: getNextId(ratings),
      shipmentId,
      raterUserId: Number(req.user.id),
      ratedUserId,
      rating,
      comment,
      createdAt: nowIso(),
    };

    ratings.unshift(newRating);
    writeJson(ratingsFile, ratings);

    res.status(201).json({
      message: 'Ocjena je uspješno spremljena.',
      rating: newRating,
    });
  } catch (error) {
    console.error('Greška POST /ratings:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});
app.get('/users/:id/ratings', authMiddleware, (req, res) => {
  try {
    const ratings = readJson(ratingsFile);

    const userRatings = ratings.filter(
      (r) => Number(r.ratedUserId) === Number(req.params.id)
    );

    const averageRating =
      userRatings.length > 0
        ? (
            userRatings.reduce(
              (sum, r) => sum + Number(r.rating || 0),
              0
            ) / userRatings.length
          ).toFixed(1)
        : null;

    res.json({
      averageRating,
      ratingsCount: userRatings.length,
      ratings: userRatings,
    });
  } catch (error) {
    console.error('Greška GET /users/:id/ratings:', error);

    res.status(500).json({
      message: 'Greška na serveru.',
    });
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
app.post('/notifications/read-all', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    let changed = false;

    notifications.forEach((notification) => {
      if (Number(notification.userId) === Number(req.user.id)) {
        notification.isRead = true;
        changed = true;
      }
    });

    if (changed) {
      writeJson(notificationsFile, notifications);
    }

    res.json({
      message: 'Sve obavijesti su označene kao pročitane.',
    });
  } catch (error) {
    console.error('Greška POST /notifications/read-all:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.delete('/notifications/read', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const filteredNotifications = notifications.filter((notification) => {
      return !(
        Number(notification.userId) === Number(req.user.id) &&
        notification.isRead === true
      );
    });

    writeJson(notificationsFile, filteredNotifications);

    res.json({
      message: 'Pročitane obavijesti su obrisane.',
    });
  } catch (error) {
    console.error('Greška DELETE /notifications/read:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.delete('/notifications/:id', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);
    const notificationId = Number(req.params.id);

    const notification = notifications.find(
      (n) => Number(n.id) === notificationId
    );

    if (!notification) {
      return res.status(404).json({
        message: 'Obavijest nije pronađena.',
      });
    }

    if (Number(notification.userId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: 'Nemate pravo obrisati ovu obavijest.',
      });
    }

    const filteredNotifications = notifications.filter(
      (n) => Number(n.id) !== notificationId
    );

    writeJson(notificationsFile, filteredNotifications);

    res.json({
      message: 'Obavijest je obrisana.',
    });
  } catch (error) {
    console.error('Greška DELETE /notifications/:id:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});

app.delete('/notifications', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const filteredNotifications = notifications.filter((notification) => {
      return Number(notification.userId) !== Number(req.user.id);
    });

    writeJson(notificationsFile, filteredNotifications);

    res.json({
      message: 'Sve obavijesti su obrisane.',
    });
  } catch (error) {
    console.error('Greška DELETE /notifications:', error);
    res.status(500).json({ message: 'Greška na serveru.' });
  }
});
// ================= START =================

runCleanup();
setInterval(runCleanup, CLEANUP_INTERVAL_MS);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TeReT backend radi na portu ${PORT}`);
});
