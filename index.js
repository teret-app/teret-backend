

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

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET nije postavljen.');
}
let firebaseReady = false;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendVerificationEmail(
  email,
  verificationUrl,
  language = 'hr'
) {
const emailText = (hr, en) =>
  language === 'en' ? en : hr;
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
     subject: emailText(
       'Potvrdite svoju email adresu - TeReT',
       'Verify your email address - TeReT'
     ),
     html: `
       <div style="font-family: Arial, sans-serif;">
         <h2>${emailText(
           'Dobrodošli u TeReT',
           'Welcome to TeReT'
         )}</h2>

         <p>${emailText(
           'Kliknite za potvrdu računa:',
           'Click below to verify your account:'
         )}</p>

         <a href="${verificationUrl}">
           ${emailText(
             'Potvrdi račun',
             'Verify account'
           )}
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
  async (req, res) => {
    if (!stripe) {
     return res.status(500).send(
       apiText(
         req,
         'Stripe nije konfiguriran.',
         'Stripe is not configured.'
       )
     );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
     return res.status(500).send(
       apiText(
         req,
         'STRIPE_WEBHOOK_SECRET nije postavljen.',
         'STRIPE_WEBHOOK_SECRET is not configured.'
       )
     );
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
      return res.status(400).send(
        `${apiText(
          req,
          'Greška webhoka',
          'Webhook error'
        )}: ${error.message}`
      );
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        const shipmentId = Number(session.metadata?.shipmentId);
        const carrierId = Number(session.metadata?.carrierId);
        const offerId = Number(session.metadata?.offerId);
        const offers = readJson(offersFile);
        const shipments = readJson(shipmentsFile);

        const shipment = shipments.find(
          (s) => Number(s.id) === shipmentId
        );

        const offer = offers.find(
          (o) =>
            Number(o.id) === offerId &&
            Number(o.shipmentId) === shipmentId &&
            Number(o.carrierId) === carrierId
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
const commissionDeadline =
  new Date(
    offer.commissionPaymentDeadlineAt ||
    shipment.commissionPaymentDeadlineAt ||
    0
  ).getTime();

if (
  !Number.isFinite(commissionDeadline) ||
  commissionDeadline <= Date.now()
) {
  console.log(
    'Stripe webhook: plaćanje je stiglo nakon isteka roka.',
    {
      shipmentId,
      carrierId,
      offerId,
    }
  );

  if (session.payment_intent) {
    await stripe.refunds.create({
      payment_intent: session.payment_intent,
    });
  }

  offer.commissionPaid = false;
  offer.contactUnlocked = false;
  offer.latePaymentRefunded = true;
  offer.latePaymentRefundedAt = nowIso();
  offer.updatedAt = nowIso();

  writeJson(offersFile, offers);

  return res.json({ received: true });
}
        offer.commissionPaid = true;
        offer.contactUnlocked = true;
        offer.stripeSessionId = session.id;
        offer.stripePaymentIntentId = session.payment_intent || null;
        offer.updatedAt = nowIso();
        shipment.commissionPaid = true;
        shipment.contactUnlocked = true;
        shipment.updatedAt = nowIso();

        writeJson(offersFile, offers);
        writeJson(shipmentsFile, shipments);
const carrierNotificationTitle = t(
  offer.carrierId,
  'Kontakt je otključan',
  'Contact unlocked',
);

const carrierNotificationMessage = t(
  offer.carrierId,
  'Sada možete pristupiti dogovoru.',
  'You can now access the agreement details.',
);
        addNotification({
          userId: offer.carrierId,
          type: 'contact_unlocked',
          title: carrierNotificationTitle,
          message: carrierNotificationMessage,
          shipmentId: shipment.id,
          offerId: offer.id,
          createdBy: offer.carrierId,
          meta: {
            commissionPaid: true,
            stripeSessionId: session.id,
          },
        });
const senderNotificationTitle = t(
  shipment.senderId,
  'TeReT vas je povezao',
  'TeReT connected you',
);

const senderNotificationMessage = t(
  shipment.senderId,
  'Prihvaćeni prijevoznik sada vidi vaše podatke i može vas kontaktirati.',
  'The accepted carrier can now see your contact details and contact you.',
);
        addNotification({
          userId: shipment.senderId,
          type: 'carrier_contact_unlocked',
         title: senderNotificationTitle,
         message: senderNotificationMessage,
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
         carrierNotificationTitle,
         carrierNotificationMessage,
          {
            type: 'contact_unlocked',
            shipmentId: shipment.id,
            offerId: offer.id,
          }
        );

        sendPushNotificationToUser(
          shipment.senderId,
          senderNotificationTitle,
          senderNotificationMessage,
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
      res.status(500).send(
        apiText(
          req,
          'Webhook obrada nije uspjela.',
          'Webhook processing failed.'
        )
      );
    }
  }
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
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
        message: apiText(
          req,
          'Stripe nije konfiguriran.',
          'Stripe is not configured.'
        ),
      });
    }

    if (!shipmentId) {
      return res.status(400).json({
        message: apiText(
          req,
          'shipmentId je obavezan.',
          'shipmentId is required.'
        ),
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
        message: apiText(
          req,
          'Prihvaćena ponuda nije pronađena.',
          'The accepted offer was not found.'
        ),
      });
    }

    if (
      acceptedOffer.commissionPaid === true ||
      acceptedOffer.contactUnlocked === true
    ) {
      return res.status(400).json({
        message: apiText(
          req,
          'Provizija je već plaćena i kontakt je već otključan.',
          'The service fee has already been paid and the contact details are already unlocked.'
        ),
      });
    }
const commissionDeadline =
  new Date(
    acceptedOffer.commissionPaymentDeadlineAt || 0
  ).getTime();

if (
  !Number.isFinite(commissionDeadline) ||
  commissionDeadline <= Date.now()
) {
  return res.status(400).json({
    message: apiText(
      req,
      'Istekao je rok od 24 sata za plaćanje naknade.',
      'The 24-hour service fee payment deadline has expired.'
    ),
  });
}
    const acceptedAmount = Number(acceptedOffer.amount);

    const calculatedCommission =
      acceptedAmount <= 100
        ? 5
        : acceptedAmount * 0.07;

    const commissionAmount = Math.round(calculatedCommission * 100);

    if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
      return res.status(400).json({
        message: apiText(
          req,
          'Neispravan iznos provizije.',
          'Invalid service fee amount.'
        ),
      });
    }
const language =
  normalizeString(req.headers['accept-language'])
    .toLowerCase()
    .startsWith('en')
      ? 'en'
      : 'hr';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',

      tax_id_collection: {
        enabled: true,
        required: 'never',
      },

      billing_address_collection: 'required',

      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: apiText(
                req,
                'TeReT provizija',
                'TeReT service fee'
              ),
            },
            unit_amount: commissionAmount,
          },
          quantity: 1,
        },
      ],

     success_url:
       `${APP_URL}/payment-success?shipmentId=${shipmentId}&lang=${language}`,

      cancel_url:
        `${APP_URL}/payment-cancel`,

      metadata: {
        carrierId: String(req.user.id),
        shipmentId: String(shipmentId),
        offerId: String(acceptedOffer.id),
      },
    });

    res.json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: apiText(
        req,
        'Greška pri kreiranju Stripe naplate.',
        'An error occurred while creating the Stripe payment.'
      ),
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
const uploadsDir = path.join(dataDir, 'uploads');
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
function normalizeLanguage(language) {
  const value = normalizeString(language).toLowerCase();

  if (value === 'en') {
    return 'en';
  }

  return 'hr';
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
    return res.status(401).json({
      message: apiText(
        req,
        'Nedostaje token.',
        'Authentication token is missing.'
      ),
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const users = readJson(usersFile);

    const user = users.find(
      (u) => Number(u.id) === Number(decoded.id)
    );

    if (!user) {
      return res.status(401).json({
        message: apiText(
          req,
          'Korisnik više ne postoji. Prijavite se ponovno.',
          'The user account no longer exists. Please sign in again.'
        ),
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message: apiText(
        req,
        'Neispravan ili istekao token.',
        'The authentication token is invalid or has expired.'
      ),
    });
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
function t(userId, hr, en) {
  const users = readJson(usersFile);

  const user = users.find(
    (u) => Number(u.id) === Number(userId)
  );

  if (user?.language === 'en') {
    return en;
  }

  return hr;
}

function apiText(req, hr, en) {
  const requestedLanguage =
    normalizeString(
      req.headers['accept-language'],
    ).toLowerCase();

  if (requestedLanguage.startsWith('en')) {
    return en;
  }

  return hr;
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
const notificationTitle = t(
  carrierId,
  'Ponuda više nije najniža',
  'Your offer is no longer the lowest',
);

const notificationMessage = t(
  carrierId,
  'Vaša ponuda više nije najniža. Pošaljite novu ponudu kako biste ostali konkurentni.',
  'Your offer is no longer the lowest. Submit a new offer to remain competitive.',
);
    addNotification({
      userId: carrierId,
      type: 'offer_outbid',
      title: notificationTitle,
      message: notificationMessage,
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
     notificationTitle,
     notificationMessage,
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

async function addNewShipmentNotifications({
  users,
  shipment,
  createdBy,
}) {
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

for (const carrier of carriers) {
   const notificationTitle = t(
     carrier.id,
     'Novi teret',
     'New shipment',
   );

   const notificationMessage = t(
     carrier.id,
     `Objavljen je novi teret: ${shipment.mjesto_utovara} → ${shipment.mjesto_istovara}`,
     `A new shipment has been posted: ${shipment.mjesto_utovara} → ${shipment.mjesto_istovara}`,
   );

   addNotification({
     userId: carrier.id,
     type: 'new_shipment',
     title: notificationTitle,
     message: notificationMessage,
     shipmentId: shipment.id,
     createdBy,
     meta: {
       naziv_tereta: shipment.naziv_tereta,
       mjesto_utovara: shipment.mjesto_utovara,
       mjesto_istovara: shipment.mjesto_istovara,
       rok_utovara: shipment.rok_utovara,
     },
   });

   await sendPushNotificationToUser(
     carrier.id,
     notificationTitle,
     notificationMessage,
     {
       type: 'new_shipment',
       shipmentId: shipment.id,
     },
   );
 }



}



function maskAddressKeepStreet(address) {
  let value = normalizeString(address);
  if (!value) return '';

  // Ukloni e-mail adresu
  value = value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    ''
  );

  // Ukloni sve što počinje oznakama za kontakt
  value = value.replace(
    /(Ansprechpartner|Kontakt|Contact|Telefon|Telephone|Phone|Mobitel|Mobile|E-mail|Email)\s*:?.*$/i,
    ''
  );

  // Ukloni kućni broj ako se nalazi na kraju preostale adrese
  value = value.replace(/\s+\d+[a-zA-Z/-]*\s*$/, '');

  return value.trim();
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
           : viewer.language === 'en'
               ? 'Other carrier'
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
const AUCTION_DECISION_HOURS = 24;
const COMMISSION_PAYMENT_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const AUCTION_CHECK_INTERVAL_MS = 60 * 1000;
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
  const offers = readJson(offersFile);
  const users = readJson(usersFile);

  let shipmentsChanged = false;
  let offersChanged = false;
  let usersChanged = false;

  const now = Date.now();

  shipments.forEach((shipment) => {
    if (!shipment.licitacija_zavrsava_at) return;

    const auctionEnd =
      new Date(shipment.licitacija_zavrsava_at).getTime();

    if (!Number.isFinite(auctionEnd)) return;

    // Licitacija je završila
    if (
      shipment.status === 'aktivan' &&
      auctionEnd <= now
    ) {
      shipment.status = 'licitacija_zavrsena';

      shipment.selectionDeadlineAt = new Date(
        auctionEnd +
        AUCTION_DECISION_HOURS * 60 * 60 * 1000
      ).toISOString();

      shipment.updatedAt = nowIso();
      shipmentsChanged = true;

      const shipmentOffers = offers.filter(
        (offer) =>
          Number(offer.shipmentId) === Number(shipment.id) &&
          offer.status !== 'rejected'
      );

      if (shipmentOffers.length > 0) {
        const notificationTitle = t(
          shipment.senderId,
          'Licitacija je završena',
          'Auction ended'
        );

        const notificationMessage = t(
          shipment.senderId,
          `Imate ${shipmentOffers.length} pristiglih ponuda. Imate 24 sata za odabir prijevoznika.`,
          `You have ${shipmentOffers.length} offers. You have 24 hours to select a carrier.`
        );

        addNotification({
          userId: shipment.senderId,
          type: 'auction_ended',
          title: notificationTitle,
          message: notificationMessage,
          shipmentId: shipment.id,
          createdBy: null,
          meta: {
            selectionDeadlineAt: shipment.selectionDeadlineAt,
          },

        });

        sendPushNotificationToUser(
          shipment.senderId,
          notificationTitle,
          notificationMessage,
          {
            type: 'auction_ended',
            shipmentId: shipment.id,
            selectionDeadlineAt: shipment.selectionDeadlineAt,
          }
        );
      }
    }

    // Naručitelj nije odabrao prijevoznika u roku 24 sata
    if (
      shipment.status === 'licitacija_zavrsena' &&
      shipment.selectionDeadlineAt
    ) {
      const selectionDeadline =
        new Date(shipment.selectionDeadlineAt).getTime();

      if (
        Number.isFinite(selectionDeadline) &&
        selectionDeadline <= now
      ) {
        const shipmentOffers = offers.filter(
          (offer) =>
            Number(offer.shipmentId) === Number(shipment.id) &&
            offer.status !== 'rejected'
        );

        shipment.status = 'zatvoreno_bez_odabira';
        shipment.closedAt = nowIso();
        shipment.updatedAt = nowIso();
        shipmentsChanged = true;

        // Propust se bilježi samo ako je bilo ponuda
        if (shipmentOffers.length > 0) {
          const sender = users.find(
            (user) =>
              Number(user.id) === Number(shipment.senderId)
          );

          if (sender) {
            sender.reliabilityMisses =
              Number(sender.reliabilityMisses || 0) + 1;

            sender.senderNoSelectionCount =
              Number(sender.senderNoSelectionCount || 0) + 1;

            sender.updatedAt = nowIso();
            usersChanged = true;
          }

          const notificationTitle = t(
            shipment.senderId,
            'Rok za odabir je istekao',
            'Selection deadline expired'
          );

          const notificationMessage = t(
            shipment.senderId,
            'Niste odabrali prijevoznika u roku od 24 sata. Propust je evidentiran u pouzdanosti računa.',
            'You did not select a carrier within 24 hours. This has been recorded in your account reliability.'
          );

          addNotification({
            userId: shipment.senderId,
            type: 'selection_deadline_missed',
            title: notificationTitle,
            message: notificationMessage,
            shipmentId: shipment.id,
            createdBy: null,
          });

          sendPushNotificationToUser(
            shipment.senderId,
            notificationTitle,
            notificationMessage,
            {
              type: 'selection_deadline_missed',
              shipmentId: shipment.id,
            }
          );
        }
      }
    }
        // Prijevoznik nije platio proviziju u roku 24 sata
        if (
          shipment.status === 'prihvaceno' &&
          shipment.commissionPaymentDeadlineAt
        ) {
          const commissionDeadline =
            new Date(shipment.commissionPaymentDeadlineAt).getTime();

          if (
            Number.isFinite(commissionDeadline) &&
            commissionDeadline <= now &&
            shipment.commissionPaid !== true
          ) {
            const acceptedOffer = offers.find(
              (offer) =>
                Number(offer.id) === Number(shipment.acceptedOfferId)
            );

            // Prihvaćenu ponudu odbijamo jer provizija nije plaćena
            if (acceptedOffer) {
              acceptedOffer.status = 'rejected';
              acceptedOffer.updatedAt = nowIso();
              offersChanged = true;
            }
const carrier = users.find(
  (user) =>
    Number(user.id) === Number(shipment.acceptedCarrierId)
);

if (carrier) {
  carrier.reliabilityMisses =
    Number(carrier.reliabilityMisses || 0) + 1;

  carrier.carrierNoPaymentCount =
    Number(carrier.carrierNoPaymentCount || 0) + 1;

  carrier.updatedAt = nowIso();
  usersChanged = true;
}
            // Teret zatvaramo bez realizacije
            shipment.status = 'zatvoreno_bez_placanja';
            shipment.closedAt = nowIso();
            shipment.updatedAt = nowIso();
            shipmentsChanged = true;

            const carrierTitle = t(
              shipment.acceptedCarrierId,
              'Rok za plaćanje je istekao',
              'Payment deadline expired',
            );

            const carrierMessage = t(
              shipment.acceptedCarrierId,
              'Niste platili naknadu za uslugu u roku od 24 sata. Prijevoz je otkazan.',
              'You did not pay the service fee within 24 hours. The transport has been cancelled.',
            );

            addNotification({
              userId: shipment.acceptedCarrierId,
              type: 'commission_payment_expired',
              title: carrierTitle,
              message: carrierMessage,
              shipmentId: shipment.id,
              createdBy: null,
            });

            sendPushNotificationToUser(
              shipment.acceptedCarrierId,
              carrierTitle,
              carrierMessage,
              {
                type: 'commission_payment_expired',
                shipmentId: shipment.id,
              },
            );

            const senderTitle = t(
              shipment.senderId,
              'Prijevoz nije potvrđen',
              'Transport not confirmed',
            );

            const senderMessage = t(
              shipment.senderId,
              'Odabrani prijevoznik nije platio naknadu za uslugu u roku od 24 sata. Prijevoz je otkazan.',
              'The selected carrier did not pay the service fee within 24 hours. The transport has been cancelled.',
            );

            addNotification({
              userId: shipment.senderId,
              type: 'commission_payment_expired',
              title: senderTitle,
              message: senderMessage,
              shipmentId: shipment.id,
              createdBy: null,
            });

            sendPushNotificationToUser(
              shipment.senderId,
              senderTitle,
              senderMessage,
              {
                type: 'commission_payment_expired',
                shipmentId: shipment.id,
              },
            );
          }
        }
  });

  if (shipmentsChanged) {
    writeJson(shipmentsFile, shipments);
  }
if (offersChanged) {
  writeJson(offersFile, offers);
}
  if (usersChanged) {
    writeJson(usersFile, users);
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
 res.json({
   message: apiText(
     req,
     'TeReT backend radi.',
     'TeReT backend is running.'
   ),
 });
});
app.get('/payment-success', (req, res) => {
  const shipmentId = req.query.shipmentId;
const language =
  normalizeString(req.query.lang).toLowerCase() === 'en'
    ? 'en'
    : 'hr';

const pageText = (hr, en) =>
  language === 'en' ? en : hr;
  res.send(`
   <html lang="${language}">
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${pageText(
          'Plaćanje uspješno',
          'Payment successful'
        )}</title>

        <script>
          window.location.replace(
            "teret://payment-success?shipmentId=${shipmentId}&lang=${language}"
          );

          setTimeout(() => {
            document.getElementById("openApp").style.display = "inline-block";
          }, 2000);
        </script>
      </head>

      <body style="font-family:Arial;text-align:center;padding:40px;">
        <h2>✅ ${pageText(
          'Plaćanje uspješno',
          'Payment successful'
        )}</h2>
        <p>${pageText(
          'Vraćamo vas u aplikaciju TeReT...',
          'Returning you to the TeReT app...'
        )}</p>

        <a
          id="openApp"
          href="teret://payment-success?shipmentId=${shipmentId}&lang=${language}"
          style="display:none;
                 padding:12px 20px;
                 background:#2563eb;
                 color:white;
                 text-decoration:none;
                 border-radius:8px;">
          ${pageText(
            'Otvori TeReT',
            'Open TeReT'
          )}
        </a>
      </body>
    </html>
  `);
});
// ================= AUTH =================

app.post('/register', async (req, res) => {
  try {
      console.log('REGISTER BODY:', {
        fullName: req.body.fullName,
        companyName: req.body.companyName,
        phone: req.body.phone,
        email: req.body.email,
        role: req.body.role,
        country: req.body.country,
      });
    const users = readJson(usersFile);

    const fullName = normalizeString(req.body.fullName || req.body.ime);
    const companyName = normalizeString(req.body.companyName || req.body.naziv_tvrtke);
    const email = normalizeString(req.body.email).toLowerCase();
    const phone = normalizeString(req.body.phone || req.body.telefon);
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role);
    const country = normalizeString(req.body.country);
    const wantsR1Invoice = req.body.wantsR1Invoice === true;
    const r1Oib = normalizeString(req.body.r1Oib);
    const r1Address = normalizeString(req.body.r1Address);
    const r1PostalCode = normalizeString(req.body.r1PostalCode);
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
        message: apiText(
          req,
          'fullName, email, phone, password i role su obavezni.',
          'fullName, email, phone, password and role are required.'
        ),
      });
    }

    if (!['sender', 'carrier'].includes(role)) {
      return res.status(400).json({
        message: apiText(
          req,
          'Neispravna uloga korisnika.',
          'Invalid user role.'
        ),
      });
    }

    const existingUser = users.find(
      (u) => normalizeString(u.email).toLowerCase() === email
    );

    if (existingUser) {
      return res.status(400).json({
        message: apiText(
          req,
          'Korisnik s tim emailom već postoji.',
          'A user with this email already exists.'
        ),
      });
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

      wantsR1Invoice,
      r1Oib,
      r1Address,
      r1PostalCode,
      emailVerified: false,
      verificationToken,
      verifiedAt: null,
      createdAt: nowIso(),
    };

      users.push(newUser);
      writeJson(usersFile, users);

      const language =
        normalizeString(req.headers['accept-language'])
          .toLowerCase()
          .startsWith('en')
            ? 'en'
            : 'hr';

      const verificationUrl =
        `${APP_URL}/verify-email/${verificationToken}?lang=${language}`;
await sendVerificationEmail(
  email,
  verificationUrl,
  language,
);

res.status(201).json({
  message: apiText(
    req,
    'Registracija uspješna. Poslali smo vam email za potvrdu računa.',
    'Registration successful. We have sent you a verification email.'
  ),

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

     res.status(500).json({
       message: apiText(
         req,
         'Greška na serveru.',
         'Server error.'
       ),
     });
   }
  });

app.get('/verify-email/:token', (req, res) => {
  try {
    const users = readJson(usersFile);
    const token = normalizeString(req.params.token);

    const user = users.find((u) => normalizeString(u.verificationToken) === token);

    if (!user) {
      return res.status(400).json({
        message: apiText(
          req,
          'Neispravan ili istekao link za potvrdu email adrese.',
          'The email verification link is invalid or has expired.'
        ),
      });
    }


    user.emailVerified = true;
    user.verificationToken = null;
    user.verifiedAt = nowIso();

    writeJson(usersFile, users);

   const language =
     normalizeString(req.query.lang).toLowerCase() === 'en'
       ? 'en'
       : 'hr';

   const pageText = (hr, en) =>
     language === 'en' ? en : hr;

   res.send(`
     <!DOCTYPE html>
     <html lang="${language}">
     <head>
       <meta charset="UTF-8" />
       <meta
         name="viewport"
         content="width=device-width, initial-scale=1.0"
       />

       <title>${pageText(
         'TeReT - račun potvrđen',
         'TeReT - Account verified'
       )}</title>
     </head>

     <body style="font-family: Arial, sans-serif; background:#f5f7fb; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;">
       <div style="background:white; padding:28px; border-radius:16px; max-width:420px; text-align:center; box-shadow:0 4px 16px rgba(0,0,0,0.08);">

         <h2 style="color:#2e7d32;">
           ${pageText(
             'Račun je potvrđen',
             'Account verified'
           )}
         </h2>

         <p>
           ${pageText(
             'Vaša email adresa je uspješno potvrđena.',
             'Your email address has been successfully verified.'
           )}
         </p>

         <p>
           ${pageText(
             'Sada se možete prijaviti u aplikaciju TeReT.',
             'You can now sign in to the TeReT app.'
           )}
         </p>
       </div>
     </body>
     </html>
   `);

} catch (error) {
  console.error('Greška /verify-email:', error);

  res.status(500).json({
    message: apiText(
      req,
      'Greška na serveru.',
      'Server error.'
    ),
  });
}
});

app.post('/resend-verification-email', async (req, res) => {
  try {
    const users = readJson(usersFile);
    const email = normalizeString(req.body.email).toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: apiText(
          req,
          'Email je obavezan.',
          'Email is required.'
        ),
      });
    }

    const user = users.find(
      (u) =>
        normalizeString(u.email).toLowerCase() === email
    );

    if (!user) {
      return res.status(404).json({
        message: apiText(
          req,
          'Korisnik s tom email adresom nije pronađen.',
          'A user with that email address was not found.'
        ),
      });
    }

    if (user.emailVerified === true) {
      return res.json({
        message: apiText(
          req,
          'Račun je već potvrđen. Možete se prijaviti.',
          'The account is already verified. You can sign in.'
        ),
      });
    }

    const verificationToken = generateVerificationToken();

    user.verificationToken = verificationToken;
    user.verificationEmailSentAt = nowIso();

    writeJson(usersFile, users);

   const language =
     normalizeString(req.headers['accept-language'])
       .toLowerCase()
       .startsWith('en')
         ? 'en'
         : 'hr';

   const verificationUrl =
     `${APP_URL}/verify-email/${verificationToken}?lang=${language}`;

   await sendVerificationEmail(
     email,
     verificationUrl,
     language,
   );

    return res.json({
      message: apiText(
        req,
        'Email za potvrdu je ponovno poslan. Provjerite inbox i spam.',
        'The verification email has been resent. Check your inbox and spam folder.'
      ),
    });
  } catch (error) {
    console.error(
      'Greška /resend-verification-email:',
      error
    );

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
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
        role: u.role,
        emailVerified: u.emailVerified,
      }))
    );

    const email =
      normalizeString(req.body.email).toLowerCase();

    const password =
      String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        message: apiText(
          req,
          'Email i lozinka su obavezni.',
          'Email and password are required.'
        ),
      });
    }

    const user = users.find(
      (u) =>
        normalizeString(u.email).toLowerCase() ===
        email
    );

    console.log('LOGIN TRAŽI EMAIL:', email);
    console.log('LOGIN USER PRONAĐEN:', !!user);

    if (!user) {
      return res.status(401).json({
        message: apiText(
          req,
          'Pogrešan email ili lozinka.',
          'Invalid email or password.'
        ),
      });
    }

    const passwordCorrect =
      await bcrypt.compare(password, user.password);

    if (!passwordCorrect) {
      return res.status(401).json({
        message: apiText(
          req,
          'Pogrešan email ili lozinka.',
          'Invalid email or password.'
        ),
      });
    }

    if (user.emailVerified !== true) {
      return res.status(403).json({
        message: apiText(
          req,
          'Račun nije potvrđen.',
          'Account has not been verified.'
        ),
      });
    }

    const token = createToken(user);

    return res.json({
      message: apiText(
        req,
        'Prijava uspješna.',
        'Login successful.'
      ),
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        companyName: user.companyName || '',
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerified:
          user.emailVerified === true,
      },
    });
  } catch (error) {
    console.error('Greška /login:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});

app.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeString(req.body.email).toLowerCase();
    const users = readJson(usersFile);

    const user = users.find(
      (u) => normalizeString(u.email).toLowerCase() === email
    );

    const genericMessage = apiText(
      req,
      'Ako račun s tim e-mailom postoji, poslana je poveznica za promjenu lozinke.',
      'If an account with that email exists, a password reset link has been sent.'
    );

    if (!user) {
      return res.json({
        message: genericMessage,
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiresAt = Date.now() + 30 * 60 * 1000;

    writeJson(usersFile, users);

    const resetUrl =
      `${APP_URL}/reset-password?token=${resetToken}&lang=${
        normalizeString(req.headers['accept-language'])
          .toLowerCase()
          .startsWith('en')
            ? 'en'
            : 'hr'
      }`;

    await mailTransporter.sendMail({
      from: `"TeReT" <${process.env.MAIL_USER}>`,
      to: user.email,
     subject: apiText(
       req,
       'TeReT – promjena lozinke',
       'TeReT – Password reset',
     ),
     html: `
       <p>${
         apiText(
           req,
           'Zaprimili smo zahtjev za promjenu lozinke.',
           'We received a password reset request.',
         )
       }</p>

       <p>
         <a href="${resetUrl}">
           ${
             apiText(
               req,
               'Postavi novu lozinku',
               'Set a new password',
             )
           }
         </a>
       </p>

       <p>${
         apiText(
           req,
           'Poveznica vrijedi 30 minuta.',
           'This link is valid for 30 minutes.',
         )
       }</p>

       <p>${
         apiText(
           req,
           'Ako niste tražili promjenu lozinke, zanemarite ovu poruku.',
           'If you did not request a password reset, please ignore this email.',
         )
       }</p>
     `,

    });

    return res.json({
      message: genericMessage,
    });
  } catch (error) {
    console.error('Greška /forgot-password:', error);

   return res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
  }
});
app.get('/reset-password', (req, res) => {
  const token = normalizeString(req.query.token);
const language =
  normalizeString(req.query.lang).toLowerCase() === 'en'
    ? 'en'
    : 'hr';

const pageText = (hr, en) =>
  language === 'en' ? en : hr;
  res.send(`
    <!DOCTYPE html>
    <html lang="${language}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${pageText(
        'TeReT - Nova lozinka',
        'TeReT - New password'
      )}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f5f5f5;
          padding: 24px;
        }

        .card {
          max-width: 420px;
          margin: 40px auto;
          background: white;
          padding: 24px;
          border-radius: 14px;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
        }

        input {
          width: 100%;
          box-sizing: border-box;
          padding: 12px;
          margin-top: 8px;
          margin-bottom: 16px;
        }

        button {
          width: 100%;
          padding: 12px;
          border: none;
          border-radius: 8px;
          background: #2e7d32;
          color: white;
          font-size: 16px;
          font-weight: bold;
        }
      </style>
    </head>

    <body>
      <div class="card">
      <h2>${pageText(
        'Postavite novu lozinku',
        'Set a new password'
      )}</h2>

      <form method="POST" action="/reset-password">
        <input type="hidden" name="token" value="${token}">
<input
  type="hidden"
  name="language"
  value="${language}"
>
        <label>${pageText(
          'Nova lozinka',
          'New password'
        )}</label>
        <div style="position:relative;margin-bottom:16px;">
          <input
            id="password"
            type="password"
            name="password"
            minlength="6"
            required
            style="width:100%;padding-right:45px;"
          >
          <span
            onclick="togglePassword('password', this)"
            style="
              position:absolute;
              right:14px;
              top:50%;
              transform:translateY(-50%);
              cursor:pointer;
              user-select:none;
              font-size:20px;
            "
          >👁️</span>
        </div>

        <label>${pageText(
          'Ponovite novu lozinku',
          'Confirm new password'
        )}</label>
        <div style="position:relative;margin-bottom:16px;">
          <input
            id="confirmPassword"
            type="password"
            name="confirmPassword"
            minlength="6"
            required
            style="width:100%;padding-right:45px;"
          >
          <span
            onclick="togglePassword('confirmPassword', this)"
            style="
              position:absolute;
              right:14px;
              top:50%;
              transform:translateY(-50%);
              cursor:pointer;
              user-select:none;
              font-size:20px;
            "
          >👁️</span>
        </div>

        <button type="submit">
          ${pageText(
            'Spremi novu lozinku',
            'Save new password'
          )}
        </button>
      </form>

      <script>
      function togglePassword(id, icon) {
        const input = document.getElementById(id);

        if (input.type === 'password') {
          input.type = 'text';
          icon.textContent = '🙈';
        } else {
          input.type = 'password';
          icon.textContent = '👁️';
        }
      }
      </script>
      </div>
    </body>
    </html>
  `);
});

app.post('/reset-password', async (req, res) => {
  try {
 const token = normalizeString(req.body.token);
 const password = String(req.body.password || '');
 const confirmPassword = String(req.body.confirmPassword || '');

 const language =
   normalizeString(req.body.language).toLowerCase() === 'en'
     ? 'en'
     : 'hr';

 const pageText = (hr, en) =>
   language === 'en' ? en : hr;

 if (!token) {
   return res.status(400).send(
     `<h3>${pageText(
       'Neispravna poveznica za promjenu lozinke.',
       'Invalid password reset link.'
     )}</h3>`
   );
 }

 if (password.length < 6) {
   return res.status(400).send(
     `<h3>${pageText(
       'Lozinka mora imati najmanje 6 znakova.',
       'The password must contain at least 6 characters.'
     )}</h3>`
   );
 }

 if (password !== confirmPassword) {
   return res.status(400).send(
     `<h3>${pageText(
       'Lozinke se ne podudaraju.',
       'The passwords do not match.'
     )}</h3>`
   );
 }

    const users = readJson(usersFile);

    const user = users.find(
      (u) =>
        u.resetPasswordToken === token &&
        Number(u.resetPasswordExpiresAt) > Date.now()
    );

    if (!user) {
      return res.status(400).send(`
        <h3>${pageText(
          'Poveznica je neispravna ili je istekla.',
          'The link is invalid or has expired.'
        )}</h3>

        <p>${pageText(
          'Ponovno zatražite promjenu lozinke u aplikaciji TeReT.',
          'Request another password reset in the TeReT app.'
        )}</p>
      `);
    }

    user.password = await bcrypt.hash(password, 10);

    delete user.resetPasswordToken;
    delete user.resetPasswordExpiresAt;

    writeJson(usersFile, users);

   return res.send(`
     <!DOCTYPE html>
     <html lang="${language}">
     <head>
       <meta charset="UTF-8">
       <meta
         name="viewport"
         content="width=device-width, initial-scale=1.0"
       >

       <title>${pageText(
         'Lozinka promijenjena',
         'Password changed'
       )}</title>
     </head>

     <body style="font-family: Arial; padding: 30px; text-align: center;">
       <h2>${pageText(
         'Lozinka je uspješno promijenjena.',
         'Your password has been changed successfully.'
       )}</h2>

       <p>${pageText(
         'Sada se možete vratiti u aplikaciju TeReT i prijaviti novom lozinkom.',
         'You can now return to the TeReT app and sign in with your new password.'
       )}</p>
     </body>
     </html>
   `);
  } catch (error) {
    console.error('Greška POST /reset-password:', error);

    return res.status(500).send(`
      <h3>${pageText(
        'Greška na serveru. Pokušajte ponovno.',
        'Server error. Please try again.'
      )}</h3>
    `);
  }
});
app.get('/me', authMiddleware, (req, res) => {
  const user = getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({
      message: apiText(
        req,
        'Korisnik nije pronađen.',
        'User not found.'
      ),
    });
  }

  res.json({
    id: user.id,
    fullName: user.fullName,
    companyName: user.companyName || '',
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified === true,
    reliabilityMisses: Number(user.reliabilityMisses || 0),
    senderNoSelectionCount: Number(user.senderNoSelectionCount || 0),
    carrierNoPaymentCount: Number(user.carrierNoPaymentCount || 0),
  });
});

// ================= FCM =================

app.post('/fcm-token', authMiddleware, (req, res) => {
  try {
    const { fcmToken, language } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({
        message: apiText(
          req,
          'FCM token je obavezan.',
          'FCM token is required.'
        ),
      });
    }

    const users = readJson(usersFile);

    const user = users.find(
      (u) => Number(u.id) === Number(req.user.id)
    );

    if (!user) {
      return res.status(404).json({
        message: apiText(
          req,
          'Korisnik nije pronađen.',
          'User not found.'
        ),
      });
    }

    users.forEach((existingUser) => {
      if (
        Number(existingUser.id) !== Number(user.id) &&
        existingUser.fcmToken === fcmToken
      ) {
        delete existingUser.fcmToken;
        delete existingUser.fcmTokenUpdatedAt;
      }
    });

    user.fcmToken = fcmToken;
    user.language = normalizeLanguage(language);
    user.fcmTokenUpdatedAt = nowIso();
    user.languageUpdatedAt = nowIso();

    writeJson(usersFile, users);

    res.json({
      success: true,
      language: user.language,
    });
  } catch (error) {
    console.error('Greška /fcm-token:', error);

    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});

// ================= SHIPMENTS =================
app.post('/shipments', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: apiText(
          req,
          'Samo naručitelj može objaviti teret.',
          'Only the sender can publish a shipment.'
        ),
      });
    }

    const shipments = readJson(shipmentsFile);
    const users = readJson(usersFile);

    const sender = users.find(
      (user) => Number(user.id) === Number(req.user.id)
    );

    if (!sender) {
      return res.status(404).json({
        message: apiText(
          req,
          'Korisnik nije pronađen.',
          'User not found.'
        ),
      });
    }

    const nazivTereta = normalizeString(
      req.body.naziv_tereta || req.body.title
    );

    const opisTereta = normalizeString(
      req.body.opis_tereta || req.body.description
    );

    const mjestoUtovara = normalizeString(
      req.body.mjesto_utovara
    );

    const mjestoIstovara = normalizeString(
      req.body.mjesto_istovara
    );

    const trajanjeLicitacije =
      normalizeString(req.body.trajanje_licitacije) ||
      '24 sata';

    const rokPreuzimanja =
      normalizeString(req.body.rok_preuzimanja) ||
      '24 sata';

    if (
      !nazivTereta ||
      !opisTereta ||
      !mjestoUtovara ||
      !mjestoIstovara
    ) {
      return res.status(400).json({
        message: apiText(
          req,
          'Naziv, opis, mjesto utovara i mjesto istovara su obavezni.',
          'The shipment name, description, loading place and unloading place are required.'
        ),
      });
    }
        const requiredShipmentFields = {
          adresa_utovara: req.body.adresa_utovara,
          adresa_istovara: req.body.adresa_istovara,
          trajanje_licitacije: req.body.trajanje_licitacije,
          rok_preuzimanja: req.body.rok_preuzimanja,
          tezina_cca_kg: req.body.tezina_cca_kg,
          duzina_cm: req.body.duzina_cm,
          sirina_cm: req.body.sirina_cm,
          visina_cm: req.body.visina_cm,
          nacin_utovara: req.body.nacin_utovara,
          tip_lokacije_utovara: req.body.tip_lokacije_utovara,
          tip_lokacije_istovara: req.body.tip_lokacije_istovara,
          broj_telefona: req.body.broj_telefona,
        };

        const missingRequiredField = Object.entries(
          requiredShipmentFields
        ).find(([_, value]) =>
          value === undefined ||
          value === null ||
          String(value).trim() === ''
        );

        if (missingRequiredField) {
          return res.status(400).json({
            message: apiText(
              req,
              'Sva obavezna polja moraju biti popunjena.',
              'All required shipment fields must be completed.'
            ),
          });
        }

        const loadingLocationType =
          normalizeString(req.body.tip_lokacije_utovara);

        const unloadingLocationType =
          normalizeString(req.body.tip_lokacije_istovara);

        if (
          (loadingLocationType === 'Zgrada' ||
            loadingLocationType === 'Poslovni prostor') &&
          !normalizeString(req.body.kat_utovara)
        ) {
          return res.status(400).json({
            message: apiText(
              req,
              'Kat utovara je obavezan za odabrani tip lokacije.',
              'The loading floor is required for the selected location type.'
            ),
          });
        }

        if (
          (unloadingLocationType === 'Zgrada' ||
            unloadingLocationType === 'Poslovni prostor') &&
          !normalizeString(req.body.kat_istovara)
        ) {
          return res.status(400).json({
            message: apiText(
              req,
              'Kat istovara je obavezan za odabrani tip lokacije.',
              'The unloading floor is required for the selected location type.'
            ),
          });
        }

        if (
          !Array.isArray(req.body.slike) ||
          req.body.slike.length === 0
        ) {
          return res.status(400).json({
            message: apiText(
              req,
              'Potrebno je dodati najmanje jednu sliku tereta.',
              'At least one shipment image is required.'
            ),
          });
        }
const shipmentText =
  `${nazivTereta} ${opisTereta}`.toLowerCase();

const forbiddenTransportAdPattern =
  /\b(nudim\s+(prijevoz|transport|transporte)|nudimo\s+(prijevoz|transport|transporte)|tražim\s+teret|trazim\s+teret|tražimo\s+teret|trazimo\s+teret|slobodan\s+(kombi|kamion|šleper|sleper)|slobodno\s+vozilo|povratna\s+tura|offering\s+transport|transport\s+available|available\s+(truck|van|vehicle)|looking\s+for\s+(load|cargo|freight))\b/i;

if (forbiddenTransportAdPattern.test(shipmentText)) {
  return res.status(400).json({
    message: apiText(
      req,
      'Ovdje se može objaviti samo konkretan teret za prijevoz. Oglasi za nuđenje prijevoza ili traženje tereta nisu dopušteni.',
      'Only specific shipments requiring transport can be posted here. Ads offering transport or looking for cargo are not allowed.'
    ),
  });
}
  let satiLicitacije = 24;

  const normalizedDuration =
    trajanjeLicitacije.toLowerCase();

  if (
    normalizedDuration === '1 sat' ||
    normalizedDuration === '1 hour' ||
    normalizedDuration === '1h'
  ) {
    satiLicitacije = 1;
  } else if (
    normalizedDuration === '2 sata' ||
    normalizedDuration === '2 hours' ||
    normalizedDuration === '2h'
  ) {
    satiLicitacije = 2;
  } else if (
    normalizedDuration === '6 sati' ||
    normalizedDuration === '6 hours' ||
    normalizedDuration === '6h'
  ) {
    satiLicitacije = 6;
  } else if (
    normalizedDuration === '12 sati' ||
    normalizedDuration === '12 hours' ||
    normalizedDuration === '12h'
  ) {
    satiLicitacije = 12;
  } else if (
    normalizedDuration === '24 sata' ||
    normalizedDuration === '24 hours' ||
    normalizedDuration === '24h'
  ) {
    satiLicitacije = 24;
  } else if (
    normalizedDuration === '48 sati' ||
    normalizedDuration === '48 hours' ||
    normalizedDuration === '48h'
  ) {
    satiLicitacije = 48;
  } else if (
    normalizedDuration === '72 sata' ||
    normalizedDuration === '72 hours' ||
    normalizedDuration === '72h'
  ) {
    satiLicitacije = 72;
  } else if (
    normalizedDuration === '7 dana' ||
    normalizedDuration === '7 days' ||
    normalizedDuration === '7d'
  ) {
    satiLicitacije = 168;
  }

    const licitacijaZavrsavaAt = new Date(
      Date.now() + satiLicitacije * 60 * 60 * 1000
    ).toISOString();

    const shipmentId = getNextId(shipments);

    let savedImages = [];

    try {
      savedImages = saveShipmentImages(
        Array.isArray(req.body.slike)
          ? req.body.slike
          : [],
        shipmentId
      );
    } catch (imageError) {
      console.error(
        'Greška spremanja slika tereta:',
        imageError
      );

      return res.status(400).json({
        message: apiText(
          req,
          'Slike tereta nije moguće spremiti.',
          'The shipment images could not be saved.'
        ),
      });
    }

    const createdAt = nowIso();

    const newShipment = {
      id: shipmentId,
      senderId: Number(req.user.id),
      status: 'aktivan',

      region: sender.region || 'Evropa',

      naziv_tereta: nazivTereta,
      opis_tereta: opisTereta,

      drzava_utovara: normalizeString(
        req.body.drzava_utovara
      ),

      mjesto_utovara: mjestoUtovara,

      adresa_utovara: normalizeString(
        req.body.adresa_utovara
      ),

      drzava_istovara: normalizeString(
        req.body.drzava_istovara
      ),

      mjesto_istovara: mjestoIstovara,

      adresa_istovara: normalizeString(
        req.body.adresa_istovara
      ),

      datum_utovara: normalizeString(
        req.body.datum_utovara
      ),

      rok_utovara: normalizeString(
        req.body.rok_utovara || req.body.rokUtovara
      ),

      rok_licitacije: normalizeString(
        req.body.rok_licitacije
      ),

      trajanje_licitacije: trajanjeLicitacije,
      rok_preuzimanja: rokPreuzimanja,
      licitacija_zavrsava_at: licitacijaZavrsavaAt,

      tezina_cca_kg: normalizeString(
        req.body.tezina_cca_kg || req.body.tezina_kg
      ),

      tezina_kg: normalizeString(
        req.body.tezina_cca_kg || req.body.tezina_kg
      ),

      broj_paleta: normalizeString(
        req.body.broj_paleta
      ),

      duzina_cm: normalizeString(
        req.body.duzina_cm
      ),

      sirina_cm: normalizeString(
        req.body.sirina_cm
      ),

      visina_cm: normalizeString(
        req.body.visina_cm
      ),

      nacin_utovara: normalizeString(
        req.body.nacin_utovara
      ),

      tip_lokacije_utovara: normalizeString(
        req.body.tip_lokacije_utovara
      ),

      tip_lokacije_istovara: normalizeString(
        req.body.tip_lokacije_istovara
      ),

      kat_utovara: normalizeString(
        req.body.kat_utovara
      ),

      kat_istovara: normalizeString(
        req.body.kat_istovara
      ),

      lift_na_utovaru:
        req.body.lift_na_utovaru === true,

      lift_na_istovaru:
        req.body.lift_na_istovaru === true,

      prilaz_za_tegljac:
        req.body.prilaz_za_tegljac === true,

      treba_pomoc_vozaca:
        req.body.treba_pomoc_vozaca === true,

      broj_telefona: normalizeString(
        req.body.broj_telefona || sender.phone
      ),

      phone: normalizeString(
        req.body.broj_telefona || sender.phone
      ),

      slike: savedImages,

      viewsCount: 0,
      viewedBy: [],

      contactUnlocked: false,
      commissionPaid: false,

      createdAt,
      updatedAt: createdAt,
    };

    shipments.unshift(newShipment);
    writeJson(shipmentsFile, shipments);

    await addNewShipmentNotifications({
      users,
      shipment: newShipment,
      createdBy: req.user.id,
    });

    return res.status(201).json({
      message: apiText(
        req,
        'Teret je uspješno objavljen.',
        'The shipment was published successfully.'
      ),
      shipment: newShipment,
    });
  } catch (error) {
    console.error('Greška /shipments POST:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});
app.put('/shipments/:id', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: apiText(
          req,
          'Samo naručitelj može uređivati objavu.',
          'Only the sender can edit a shipment listing.'
        ),
      });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);
    const users = readJson(usersFile);

    const carrier = users.find(
      (u) => Number(u.id) === Number(req.user.id)
    );

    if (!carrier) {
      return res.status(404).json({
        message: apiText(
          req,
          'Prijevoznik nije pronađen.',
          'Carrier not found.'
        ),
      });
    }

    const shipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!shipment) {
      return res.status(404).json({
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.'
        ),
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: apiText(
          req,
          'Nemate pravo uređivati ovaj teret.',
          'You are not allowed to edit this shipment.'
        ),
      });
    }

    if (shipment.status !== 'aktivan') {
      return res.status(400).json({
        message: apiText(
          req,
          'Objavu je moguće uređivati samo dok je aktivna.',
          'The listing can only be edited while it is active.'
        ),
      });
    }

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        (
          o.status === 'accepted' ||
          o.status === 'prihvaceno' ||
          o.status === 'prihvaćeno'
        )
    );

    if (acceptedOffer) {
      return res.status(400).json({
        message: apiText(
          req,
          'Objavu nije moguće uređivati nakon prihvaćanja ponude.',
          'The listing cannot be edited after an offer has been accepted.'
        ),
      });
    }

    shipment.naziv_tereta = normalizeString(
      req.body.naziv_tereta || shipment.naziv_tereta
    );

    shipment.opis_tereta = normalizeString(
      req.body.opis_tereta || shipment.opis_tereta
    );

    shipment.mjesto_utovara = normalizeString(
      req.body.mjesto_utovara || shipment.mjesto_utovara
    );

    shipment.mjesto_istovara = normalizeString(
      req.body.mjesto_istovara || shipment.mjesto_istovara
    );

    shipment.updatedAt = nowIso();

    writeJson(shipmentsFile, shipments);

    res.json({
      message: apiText(
        req,
        'Objava je uspješno ažurirana.',
        'The listing has been updated successfully.'
      ),
      shipment,
    });
  } catch (error) {
    console.error('Greška PUT /shipments/:id:', error);

    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
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
        senderName: senderUser
          ? senderUser.fullName ||
            apiText(
              req,
              'Naručitelj',
              'Sender'
            )
          : apiText(
              req,
              'Naručitelj',
              'Sender'
            ),
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
             ? apiText(
                 req,
                 'Najniža',
                 'Lowest'
               )
             : apiText(
                 req,
                 'Nadmašena',
                 'Outbid'
               )
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

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
 }
});

app.get('/my-shipments', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: apiText(
          req,
          'Samo naručitelj može vidjeti svoje objave.',
          'Only the sender can view their shipment listings.'
        ),
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

  res.status(500).json({
    message: apiText(
      req,
      'Greška na serveru.',
      'Server error.'
    ),
  });
}
});
app.put('/shipments/:id/hide', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
      return res.status(403).json({
        message: apiText(
          req,
          'Samo naručitelj može ukloniti objavu iz povijesti.',
          'Only the sender can remove a listing from history.'
        ),
      });
    }

    const shipments = readJson(shipmentsFile);

    const shipment = shipments.find(
      (s) => Number(s.id) === Number(req.params.id)
    );

    if (!shipment) {
    return res.status(404).json({
      message: apiText(
        req,
        'Teret nije pronađen.',
        'Shipment not found.'
      ),
    });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
     return res.status(403).json({
       message: apiText(
         req,
         'Nemate pravo ukloniti ovu objavu.',
         'You are not allowed to remove this listing.'
       ),
     });
    }

    const status = normalizeString(shipment.status).toLowerCase();

     const auctionEnded =
       shipment.licitacija_zavrsava_at &&
       new Date(shipment.licitacija_zavrsava_at).getTime() <= Date.now();

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
       status === 'povučeno' ||
       auctionEnded;

    if (!canHide) {
     return res.status(400).json({
       message: apiText(
         req,
         'Samo završene, istekle ili povučene objave mogu se ukloniti iz povijesti.',
         'Only completed, expired or withdrawn listings can be removed from history.'
       ),
     });
    }

    shipment.hiddenBySender = true;
    shipment.hiddenBySenderAt = nowIso();
    shipment.updatedAt = nowIso();

    writeJson(shipmentsFile, shipments);

    res.json({
      message: apiText(
        req,
        'Objava je uklonjena iz povijesti.',
        'The listing was removed from history.'
      ),
    });
 } catch (error) {
   console.error('Greška PUT /shipments/:id/hide:', error);

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
 }
});
app.post('/shipments/:id/repost', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
    return res.status(403).json({
      message: apiText(
        req,
        'Samo naručitelj može ponovno objaviti teret.',
        'Only the sender can repost a shipment.'
      ),
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
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.'
        ),
      });
    }



  if (Number(oldShipment.senderId) !== Number(req.user.id)) {
    return res.status(403).json({
      message: apiText(
        req,
        'Nemate pravo ponovno objaviti ovaj teret.',
        'You are not allowed to repost this shipment.'
      ),
    });
  }
    const oldOffers = offers.filter(
      (o) =>
        Number(o.shipmentId) === Number(oldShipment.id) &&
        o.status !== 'rejected'
    );

   if (oldOffers.length > 0) {
     return res.status(400).json({
       message: apiText(
         req,
         'Teret se može ponovno objaviti samo ako nije bilo ponuda.',
         'A shipment can only be reposted if it had no offers.'
       ),
     });
   }
    const existingActiveRepost = shipments.find((shipment) => {
      if (
        Number(shipment.repostedFromId) !== Number(oldShipment.id) ||
        Number(shipment.senderId) !== Number(req.user.id)
      ) {
        return false;
      }

      const status = normalizeString(shipment.status).toLowerCase();

      const isActiveStatus =
        status === 'aktivan' ||
        status === 'active';

      const auctionEnd = new Date(
        shipment.licitacija_zavrsava_at
      ).getTime();

      const auctionStillRunning =
        Number.isFinite(auctionEnd) && auctionEnd > Date.now();

      return isActiveStatus && auctionStillRunning;
    });

   if (existingActiveRepost) {
     return res.status(409).json({
       message: apiText(
         req,
         'Ovaj teret je već ponovno objavljen i licitacija je još aktivna.',
         'This shipment has already been reposted and the auction is still active.'
       ),
       shipmentId: existingActiveRepost.id,
     });
   }
    const trajanjeLicitacije =
      oldShipment.trajanje_licitacije || '24 sata';


 let satiLicitacije = 24;

 const normalizedDuration =
   trajanjeLicitacije.toLowerCase();

 if (
   normalizedDuration === '1 sat' ||
   normalizedDuration === '1 hour' ||
   normalizedDuration === '1h'
 ) {
   satiLicitacije = 1;
 } else if (
   normalizedDuration === '2 sata' ||
   normalizedDuration === '2 hours' ||
   normalizedDuration === '2h'
 ) {
   satiLicitacije = 2;
 } else if (
   normalizedDuration === '6 sati' ||
   normalizedDuration === '6 hours' ||
   normalizedDuration === '6h'
 ) {
   satiLicitacije = 6;
 } else if (
   normalizedDuration === '12 sati' ||
   normalizedDuration === '12 hours' ||
   normalizedDuration === '12h'
 ) {
   satiLicitacije = 12;
 } else if (
   normalizedDuration === '24 sata' ||
   normalizedDuration === '24 hours' ||
   normalizedDuration === '24h'
 ) {
   satiLicitacije = 24;
 } else if (
   normalizedDuration === '48 sati' ||
   normalizedDuration === '48 hours' ||
   normalizedDuration === '48h'
 ) {
   satiLicitacije = 48;
 } else if (
   normalizedDuration === '72 sata' ||
   normalizedDuration === '72 hours' ||
   normalizedDuration === '72h'
 ) {
   satiLicitacije = 72;
 } else if (
   normalizedDuration === '7 dana' ||
   normalizedDuration === '7 days' ||
   normalizedDuration === '7d'
 ) {
   satiLicitacije = 168;
 }

    const licitacijaZavrsavaAt = new Date(
      Date.now() + satiLicitacije * 60 * 60 * 1000
    ).toISOString();
    console.log('SHIPMENT BODY:', req.body);
    console.log('DRZAVA UTOVARA:', req.body.drzava_utovara);
    console.log('DRZAVA ISTOVARA:', req.body.drzava_istovara);
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
      message: apiText(
        req,
        'Teret je ponovno objavljen.',
        'Shipment reposted successfully.'
      ),
      shipment: newShipment,
    });
 } catch (error) {
   console.error('Greška /shipments/:id/repost:', error);

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
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
     return res.status(404).json({
       message: apiText(
         req,
         'Teret nije pronađen.',
         'Shipment not found.'
       ),
     });
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
      ratingTargetLabel = apiText(
        req,
        'prijevoznika',
        'carrier',
      );
    }

    if (isAcceptedCarrier) {
      ratingTargetUserId = Number(shipment.senderId);
      ratingTargetLabel = apiText(
        req,
        'naručitelja',
        'sender',
      );
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
       ? acceptedPrice <= 100
         ? 5
         : acceptedPrice * 0.07
       : null;

    res.json({
      ...sanitized,
      isSenderOwner,
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

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
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
     return res.status(404).json({
       message: apiText(
         req,
         'Teret nije pronađen.',
         'Shipment not found.'
       ),
     });
   }

    const isSenderOwner =
      req.user.role === 'sender' && Number(shipment.senderId) === Number(req.user.id);

    const isCarrier = isCarrierRole(req.user.role);

   if (!isSenderOwner && !isCarrier) {
     return res.status(403).json({
       message: apiText(
         req,
         'Nemate pristup tijeku licitacije.',
         'You do not have access to the auction progress.'
       ),
     });
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
           ? apiText(req, 'Najniža', 'Lowest')
           : apiText(req, 'Nadmašena', 'Outbid')
         : null,
      bidHistory,
    });
 } catch (error) {
   console.error('Greška /shipments/:id/bid-history:', error);

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
 }
});

// ================= OFFERS =================
app.put('/offers/:id/hide', authMiddleware, (req, res) => {
  try {
   if (!isCarrierRole(req.user.role)) {
     return res.status(403).json({
       message: apiText(
         req,
         'Samo prijevoznik može ukloniti ponudu iz povijesti.',
         'Only the carrier can remove an offer from history.'
       ),
     });
   }

    const offers = readJson(offersFile);

    const offer = offers.find(
      (o) => Number(o.id) === Number(req.params.id)
    );

   if (!offer) {
     return res.status(404).json({
       message: apiText(
         req,
         'Ponuda nije pronađena.',
         'Offer not found.'
       ),
     });
   }

  if (Number(offer.carrierId) !== Number(req.user.id)) {
    return res.status(403).json({
      message: apiText(
        req,
        'Nemate pristup ovoj ponudi.',
        'You do not have access to this offer.'
      ),
    });
  }

    offer.hiddenByCarrier = true;
    offer.hiddenByCarrierAt = nowIso();

    writeJson(offersFile, offers);

   res.json({
     message: apiText(
       req,
       'Ponuda je uklonjena iz povijesti.',
       'Offer removed from history.'
     ),
   });
 } catch (error) {
   console.error('Greška /offers/:id/hide:', error);

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
 }
    });

app.post('/offers', authMiddleware, (req, res) => {
  try {
   if (!isCarrierRole(req.user.role)) {
     return res.status(403).json({
       message: apiText(
         req,
         'Samo prijevoznik može slati ponude.',
         'Only the carrier can submit offers.'
       ),
     });
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
    message: apiText(
      req,
      'Poruka ponude ne smije sadržavati kontakt podatke, brojeve telefona, email adrese ili pozive na dogovor izvan aplikacije.',
      'The offer message must not contain contact details, phone numbers, email addresses, or invitations to arrange transport outside the app.',
    ),
  });
}
   if (!shipmentId || amount === undefined || amount === null || amount === '') {
     return res.status(400).json({
       message: apiText(
         req,
         'Podaci o teretu i iznos ponude su obavezni.',
         'Shipment details and offer amount are required.',
       ),
     });
   }

    const shipment = shipments.find((s) => Number(s.id) === Number(shipmentId));
    if (!shipment) {
     return res.status(404).json({
       message: apiText(
         req,
         'Teret nije pronađen.',
         'Shipment not found.',
       ),
     });
    }

    if (shipment.status !== 'aktivan') {
      return res.status(400).json({
        message: apiText(
          req,
          'Na ovaj teret više nije moguće slati ponude.',
          'Offers can no longer be submitted for this shipment.',
        ),
      });
    }

    if (shipment.licitacija_zavrsava_at) {
      const licitacijaZavrsena = new Date(shipment.licitacija_zavrsava_at).getTime() <= Date.now();

      if (licitacijaZavrsena) {
        shipment.status = 'licitacija_zavrsena';
        shipment.updatedAt = nowIso();

        writeJson(shipmentsFile, shipments);

       return res.status(400).json({
         message: apiText(
           req,
           'Licitacija je završena. Nije više moguće slati ponude za ovaj teret.',
           'The auction has ended. Offers can no longer be submitted for this shipment.',
         ),
       });
      }
    }

    const existingAcceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === Number(shipment.id) &&
        (o.status === 'accepted' || o.status === 'prihvaceno' || o.status === 'prihvaćeno')
    );

    if (existingAcceptedOffer) {
     return res.status(400).json({
       message: apiText(
         req,
         'Ponuda je već prihvaćena za ovaj teret.',
         'An offer has already been accepted for this shipment.',
       ),
     });
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
            message: apiText(
              req,
              'Nova ponuda mora biti niža ili jednaka vašoj prethodnoj ponudi.',
              'The new offer must be lower than or equal to your previous offer.',
            ),
          });

      }

      if (toNumber(existingMyOffer.amount) - numericAmount < 5) {
          return res.status(400).json({
            message: apiText(
              req,
              `Minimalno sniženje ponude je 5 ${currency}.`,
              `The minimum offer reduction is 5 ${currency}.`,
            ),
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
const updatedOfferNotificationTitle = t(
  shipment.senderId,
  'Ponuda ažurirana',
  'Offer updated',
);

const updatedOfferNotificationMessage = t(
  shipment.senderId,
  'Prijevoznik je ažurirao svoju ponudu za vaš teret.',
  'A carrier has updated their offer for your shipment.',
);
      addNotification({
        userId: shipment.senderId,
        type: 'offer_updated',
       title: updatedOfferNotificationTitle,
       message: updatedOfferNotificationMessage,
        shipmentId: shipment.id,
        offerId: existingMyOffer.id,
        createdBy: req.user.id,
      });
sendPushNotificationToUser(
  shipment.senderId,
  updatedOfferNotificationTitle,
  updatedOfferNotificationMessage,
  {
    type: 'offer_updated',
    shipmentId: shipment.id,
    offerId: existingMyOffer.id,
  }
);
      addOutbidNotifications({
        offers,
        shipment,
        currentCarrierId: req.user.id,
        currentOfferId: existingMyOffer.id,
      });

     return res.json({
       message: apiText(
         req,
         'Ponuda je uspješno ažurirana.',
         'The offer was updated successfully.',
       ),
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
const notificationTitle = t(
  shipment.senderId,
  'Nova ponuda',
  'New offer',
);

const notificationMessage = t(
  shipment.senderId,
  'Zaprimili ste novu ponudu za vaš teret.',
  'You have received a new offer for your shipment.',
);
    addNotification({
      userId: shipment.senderId,
      type: 'offer_created',
      title: notificationTitle,
      message: notificationMessage,
      shipmentId: shipment.id,
      offerId: newOffer.id,
      createdBy: req.user.id,
    });
    sendPushNotificationToUser(
      shipment.senderId,
      notificationTitle,
      notificationMessage,
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
      message: apiText(
        req,
        'Ponuda je uspješno poslana.',
        'The offer was submitted successfully.',
      ),
      offer: newOffer,
    });
    } catch (error) {
      console.error('Greška /offers POST:', error);

      res.status(500).json({
        message: apiText(
          req,
          'Greška na serveru.',
          'Server error.',
        ),
      });
    }
});

app.get('/my-offers', authMiddleware, (req, res) => {
  try {
    if (!isCarrierRole(req.user.role)) {
      return res.status(403).json({
        message: apiText(
          req,
          'Samo prijevoznik može vidjeti svoje ponude.',
          'Only a carrier can view their offers.',
        ),
      });
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
           ? apiText(req, 'Najniža', 'Lowest')
           : apiText(req, 'Nadmašena', 'Outbid')
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
    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.',
      ),
    });
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
      return res.status(404).json({
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.',
        ),
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: apiText(
          req,
          'Nemate pristup ponudama za ovaj teret.',
          'You do not have access to the offers for this shipment.',
        ),
      });
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
    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.',
      ),
    });
  }
});



app.post('/offers/:id/accept', authMiddleware, (req, res) => {
     try {
    const shipments = readJson(shipmentsFile);
if (req.user.role !== 'sender') {
 return res.status(403).json({
   message: apiText(
     req,
     'Samo naručitelj može prihvatiti ponudu.',
     'Only the sender can accept an offer.',
   ),
 });
}

const offers = readJson(offersFile);
    const offer = offers.find((o) => Number(o.id) === Number(req.params.id));
    if (!offer) {
      return res.status(404).json({
        message: apiText(
          req,
          'Ponuda nije pronađena.',
          'Offer not found.',
        ),
      });
    }

    const shipment = shipments.find((s) => Number(s.id) === Number(offer.shipmentId));
    if (!shipment) {
      return res.status(404).json({
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.',
        ),
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: apiText(
          req,
          'Nemate pravo prihvatiti ovu ponudu.',
          'You are not allowed to accept this offer.',
        ),
      });
    }

    const shipmentStatus =
      normalizeString(shipment.status).toLowerCase();

    const canAcceptOffer =
      shipmentStatus === 'aktivan' ||
      shipmentStatus === 'licitacija_zavrsena' ||
      shipmentStatus === 'licitacija završena';

    if (!canAcceptOffer) {
      return res.status(400).json({
        message: apiText(
          req,
          'Ponudu više nije moguće prihvatiti za ovaj teret.',
          'An offer can no longer be accepted for this shipment.',
        ),
      });
    }
if (
  shipmentStatus === 'licitacija_zavrsena' ||
  shipmentStatus === 'licitacija završena'
) {
  const selectionDeadline =
    new Date(shipment.selectionDeadlineAt || 0).getTime();

  if (
    !Number.isFinite(selectionDeadline) ||
    selectionDeadline <= Date.now()
  ) {
    return res.status(400).json({
      message: apiText(
        req,
        'Istekao je rok od 24 sata za odabir prijevoznika.',
        'The 24-hour deadline for selecting a carrier has expired.',
      ),
    });
  }
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
    shipment.commissionPaymentDeadlineAt = new Date(
      Date.now() +
      COMMISSION_PAYMENT_HOURS * 60 * 60 * 1000
    ).toISOString();

    offer.commissionPaymentDeadlineAt =
      shipment.commissionPaymentDeadlineAt;
    shipment.updatedAt = nowIso();

    writeJson(offersFile, offers);
    writeJson(shipmentsFile, shipments);
const acceptedNotificationTitle = t(
  offer.carrierId,
  'Dobili ste posao',
  'You got the job',
);

const acceptedNotificationMessage = t(
  offer.carrierId,
  'Vaša ponuda je prihvaćena. Za nastavak platite naknadu putem Stripe Checkouta kako biste otključali kontakt podatke.',
  'Your offer has been accepted. Continue to Stripe Checkout and pay the fee to unlock the contact details.',
);
    addNotification({
      userId: offer.carrierId,
      type: 'offer_accepted',
     title: acceptedNotificationTitle,
     message: acceptedNotificationMessage,
      shipmentId: shipment.id,
      offerId: offer.id,
      createdBy: req.user.id,
    });

sendPushNotificationToUser(
  offer.carrierId,
  acceptedNotificationTitle,
  acceptedNotificationMessage,
  {
    type: 'offer_accepted',
    shipmentId: shipment.id,
    offerId: offer.id,
  }
);
rejectedOffers.forEach((rejectedOffer) => {
const rejectedNotificationTitle = t(
  rejectedOffer.carrierId,
  'Licitacija je završena',
  'Auction ended',
);

const rejectedNotificationMessage = t(
  rejectedOffer.carrierId,
  'Drugi prijevoznik je odabran za ovaj prijevoz.',
  'Another carrier was selected for this shipment.',
);
  addNotification({
    userId: rejectedOffer.carrierId,
    type: 'offer_rejected',
    title: rejectedNotificationTitle,
    message: rejectedNotificationMessage,
    shipmentId: shipment.id,
    offerId: rejectedOffer.id,
    createdBy: req.user.id,
  });

  sendPushNotificationToUser(
    rejectedOffer.carrierId,
    rejectedNotificationTitle,
    rejectedNotificationMessage,
    {
      type: 'offer_rejected',
      shipmentId: shipment.id,
      offerId: rejectedOffer.id,
    }
  );
});
  res.json({
    message: apiText(
      req,
      'Ponuda je uspješno prihvaćena.',
      'The offer was accepted successfully.'
    ),
    offer,
    shipment,
  });
 } catch (error) {
   console.error('Greška /offers/:id/accept:', error);

   res.status(500).json({
     message: apiText(
       req,
       'Greška na serveru.',
       'Server error.'
     ),
   });
 }
});

// ================= CONTACT UNLOCK / COMMISSION =================
app.post('/shipments/:id/pay-commission', authMiddleware, (req, res) => {
  return res.status(410).json({
    message: apiText(
      req,
      'Plaćanje se sada izvršava isključivo preko Stripe Checkouta.',
      'Payments are now processed exclusively through Stripe Checkout.'
    ),
  });
});

// ================= DELIVERY CONFIRM =================

app.post('/shipments/:id/confirm-delivery', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'sender') {
     return res.status(403).json({
       message: apiText(
         req,
         'Samo naručitelj može potvrditi isporuku.',
         'Only the sender can confirm delivery.',
       ),
     });
    }

    const shipments = readJson(shipmentsFile);
    const offers = readJson(offersFile);

    const shipment = shipments.find((s) => Number(s.id) === Number(req.params.id));
    if (!shipment) {
      return res.status(404).json({
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.',
        ),
      });
    }

    if (Number(shipment.senderId) !== Number(req.user.id)) {
      return res.status(403).json({
        message: apiText(
          req,
          'Nemate pravo potvrditi ovu isporuku.',
          'You are not allowed to confirm this delivery.',
        ),
      });
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
    const deliveryNotificationTitle = t(
      acceptedOffer.carrierId,
      'Prijevoz dogovoren',
      'Transport completed',
    );

    const deliveryNotificationMessage = t(
      acceptedOffer.carrierId,
      'Naručitelj je potvrdio da je prijevoz dogovoren.',
      'The sender confirmed that the transport was completed.',
    );
      addNotification({
        userId: acceptedOffer.carrierId,
        type: 'delivery_confirmed',
        title: deliveryNotificationTitle,
        message: deliveryNotificationMessage,
        shipmentId: shipment.id,
        offerId: acceptedOffer.id,
        createdBy: req.user.id,
      });
      sendPushNotificationToUser(
        acceptedOffer.carrierId,
        deliveryNotificationTitle,
        deliveryNotificationMessage,
        {
          type: 'delivery_confirmed',
          shipmentId: shipment.id,
          offerId: acceptedOffer.id,
        }
      );
    }
res.json({
  message: apiText(
    req,
    'Prijevoz je završen.',
    'The transport has been completed.',
  ),
  shipment,
});
} catch (error) {
  console.error('Greška /shipments/:id/confirm-delivery:', error);

  res.status(500).json({
    message: apiText(
      req,
      'Greška na serveru.',
      'Server error.',
    ),
  });
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
        message: apiText(
          req,
          'Podaci o prijevozu i ocjena su obavezni.',
          'Shipment and rating are required.',
        ),
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        message: apiText(
          req,
          'Ocjena mora biti između 1 i 5.',
          'The rating must be between 1 and 5.',
        ),
      });
    }

    const shipment = shipments.find((s) => Number(s.id) === shipmentId);

    if (!shipment) {
      return res.status(404).json({
        message: apiText(
          req,
          'Teret nije pronađen.',
          'Shipment not found.',
        ),
      });
    }

    const acceptedOffer = offers.find(
      (o) =>
        Number(o.shipmentId) === shipmentId &&
        String(o.status).toLowerCase() === 'accepted'
    );

    if (!acceptedOffer) {
      return res.status(400).json({
        message: apiText(
          req,
          'Nema prihvaćene ponude za ovaj prijevoz.',
          'There is no accepted offer for this transport.',
        ),
      });
    }

    let ratedUserId;

    if (Number(req.user.id) === Number(shipment.senderId)) {
      ratedUserId = Number(acceptedOffer.carrierId);
    } else if (Number(req.user.id) === Number(acceptedOffer.carrierId)) {
      ratedUserId = Number(shipment.senderId);
    } else {
      return res.status(403).json({
        message: apiText(
          req,
          'Nemate pravo ocijeniti ovaj prijevoz.',
          'You are not allowed to rate this transport.',
        ),
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
        message: apiText(
          req,
          'Već ste ocijenili ovog korisnika za ovaj prijevoz.',
          'You have already rated this user for this transport.',
        ),
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
      message: apiText(
        req,
        'Ocjena je uspješno spremljena.',
        'The rating has been saved successfully.',
      ),
      rating: newRating,
    });
  } catch (error) {
    console.error('Greška POST /ratings:', error);

    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.',
      ),
    });
  }
});

app.get('/users/:id/ratings', authMiddleware, (req, res) => {
  try {
    const ratings = readJson(ratingsFile);
    const users = readJson(usersFile);

    const profileUser = users.find(
     (u) => Number(u.id) === Number(req.params.id)
    );
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
      reliabilityMisses: Number(profileUser?.reliabilityMisses || 0),
      senderNoSelectionCount: Number(profileUser?.senderNoSelectionCount || 0),
      carrierNoPaymentCount: Number(profileUser?.carrierNoPaymentCount || 0),
      ratings: userRatings,
    });
  } catch (error) {
    console.error('Greška GET /users/:id/ratings:', error);

    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.',
      ),
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

    res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.',
      ),
    });
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
      return res.status(404).json({
        message: apiText(
          req,
          'Obavijest nije pronađena.',
          'Notification not found.'
        ),
      });
    }

    notification.isRead = true;
    notification.readAt = nowIso();

    writeJson(notificationsFile, notifications);

    return res.json({
      message: apiText(
        req,
        'Obavijest je označena kao pročitana.',
        'The notification has been marked as read.'
      ),
      notification,
    });
  } catch (error) {
    console.error('Greška POST /notifications/:id/read:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});

app.delete('/notifications/read', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const remainingNotifications = notifications.filter(
      (n) =>
        Number(n.userId) !== Number(req.user.id) ||
        n.isRead !== true
    );

    const deletedCount =
      notifications.length - remainingNotifications.length;

    writeJson(notificationsFile, remainingNotifications);

    return res.json({
      message: apiText(
        req,
        'Pročitane obavijesti su obrisane.',
        'Read notifications have been deleted.'
      ),
      deletedCount,
    });
  } catch (error) {
    console.error('Greška DELETE /notifications/read:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});

app.delete('/notifications/:id', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const notificationIndex = notifications.findIndex(
      (n) =>
        Number(n.id) === Number(req.params.id) &&
        Number(n.userId) === Number(req.user.id)
    );

    if (notificationIndex === -1) {
      return res.status(404).json({
        message: apiText(
          req,
          'Obavijest nije pronađena.',
          'Notification not found.'
        ),
      });
    }

    const deletedNotification = notifications[notificationIndex];

    notifications.splice(notificationIndex, 1);

    writeJson(notificationsFile, notifications);

    return res.json({
      message: apiText(
        req,
        'Obavijest je obrisana.',
        'The notification has been deleted.'
      ),
      notification: deletedNotification,
    });
  } catch (error) {
    console.error('Greška DELETE /notifications/:id:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});

app.delete('/notifications', authMiddleware, (req, res) => {
  try {
    const notifications = readJson(notificationsFile);

    const remainingNotifications = notifications.filter(
      (n) => Number(n.userId) !== Number(req.user.id)
    );

    const deletedCount =
      notifications.length - remainingNotifications.length;

    writeJson(notificationsFile, remainingNotifications);

    return res.json({
      message: apiText(
        req,
        'Sve obavijesti su obrisane.',
        'All notifications have been deleted.'
      ),
      deletedCount,
    });
  } catch (error) {
    console.error('Greška DELETE /notifications:', error);

    return res.status(500).json({
      message: apiText(
        req,
        'Greška na serveru.',
        'Server error.'
      ),
    });
  }
});
runCleanup();

setInterval(
  runCleanup,
  CLEANUP_INTERVAL_MS
);
setInterval(
  cleanupExpiredShipments,
  AUCTION_CHECK_INTERVAL_MS
);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ TeReT backend radi na portu ${PORT}`);
});