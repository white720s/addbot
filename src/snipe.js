// Snipe engine — polls the Rolimons trade ad feed every 2 minutes,
// finds ads requesting items a user has sniped, and posts embed
// notifications in their dedicated snipe channel.

const { EmbedBuilder } = require('discord.js');
const rolimonsApi = require('./rolimons-api');
const store = require('./store');

// Active snipe loops: Map<discordId, { itemId, itemName, acronym, intervalHandle, seenAdIds }>
const activeSnipes = new Map();

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Format a value number into a readable string like "1.5M" or "320K"
function formatValue(val) {
  if (!val || val < 0) return '?';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

// Determine if an offer is overpay, lowball, or even vs. the item's value.
// Returns { label, difference, pct, isOverpay }
function calcOverpayLabel(offerValue, requestValue) {
  if (!offerValue || !requestValue || offerValue <= 0 || requestValue <= 0) {
    return { label: 'Unknown value', difference: 0, pct: 0, isOverpay: false };
  }
  const diff = offerValue - requestValue;
  const pct = ((diff / requestValue) * 100).toFixed(2);
  const absPct = Math.abs(pct);
  const absDiff = Math.abs(diff);

  if (Math.abs(diff) < requestValue * 0.02) {
    return { label: 'Even', difference: diff, pct, isOverpay: true };
  }
  if (diff > 0) {
    return { label: `${formatValue(absDiff)} Overpay`, difference: diff, pct, isOverpay: true };
  }
  return { label: `${formatValue(absDiff)} Lowball`, difference: diff, pct, isOverpay: false };
}

// Build the Discord embed for a matching trade ad.
async function buildSnipeEmbed(ad, targetItemId, targetItemName, targetItemAcronym, catalog, userDiscordId) {
  // ad shape (from Rolimons getrecentads, confirmed via Roblox API module docs):
  // ad[0] = player_id
  // ad[1] = username
  // ad[2] = offer_item_ids (array)
  // ad[3] = request_item_ids (array)
  // ad[4] = request_tags (array of strings)
  // ad[5] = offer_robux
  // ad[6] = request_robux (usually 0)
  // ad[7] = timestamp

  // NOTE: The exact array indices above are our best construction from
  // partial documentation. They may need adjustment after a live test —
  // same pattern as the login/inventory fixes. We'll verify with the
  // real response on first run.

  const offererUsername = ad[1] || 'Unknown';
  const offererPlayerId = ad[0];
  const offerItemIds = ad[2] || [];
  const requestItemIds = ad[3] || [];
  const requestTags = ad[4] || [];
  const offerRobux = ad[5] || 0;

  // Get catalog details for offer items
  const catalogById = new Map(catalog.map(i => [String(i.id), i]));

  const offerItems = offerItemIds.map(id => {
    const c = catalogById.get(String(id));
    const manual = rolimonsApi.MANUAL_ITEM_NAMES[String(id)];
    return {
      id: String(id),
      name: c?.name || manual?.name || `Item ${id}`,
      acronym: c?.acronym || manual?.acronym || '—',
      value: c?.value || 0,
      rap: c?.rap || 0,
    };
  });

  const requestItems = requestItemIds.map(id => {
    const c = catalogById.get(String(id));
    const manual = rolimonsApi.MANUAL_ITEM_NAMES[String(id)];
    return {
      id: String(id),
      name: c?.name || manual?.name || `Item ${id}`,
      acronym: c?.acronym || manual?.acronym || '—',
      value: c?.value || 0,
      rap: c?.rap || 0,
    };
  });

  // Calculate total values
  const totalOfferValue = offerItems.reduce((sum, i) => sum + (i.value || 0), 0);
  const totalRequestValue = requestItems.reduce((sum, i) => sum + (i.value || 0), 0);
  const totalOfferRap = offerItems.reduce((sum, i) => sum + (i.rap || 0), 0);
  const totalRequestRap = requestItems.reduce((sum, i) => sum + (i.rap || 0), 0);

  const { label, difference, pct, isOverpay } = calcOverpayLabel(totalOfferValue, totalRequestValue);

  // Build offer/request description lines
  const offerLines = offerItems.map(i => `**${i.acronym}** - ${formatValue(i.value)}`).join('\n') +
    (offerRobux > 0 ? `\n**Robux** - ${offerRobux.toLocaleString()}` : '');

  const requestLine = `**${targetItemAcronym}** - ${formatValue(totalRequestValue)}`;
  const tagLine = requestTags.length ? `\nTags: ${requestTags.join(', ')}` : '';

  const valueLine = `Value: ${formatValue(totalRequestValue)} → ${formatValue(totalOfferValue)} (${difference > 0 ? '+' : ''}${formatValue(Math.abs(difference))}, ${pct > 0 ? '+' : ''}${pct}%)`;
  const rapLine = `RAP: ${formatValue(totalRequestRap)} → ${formatValue(totalOfferRap)}`;

  const thumbnailUrl = await rolimonsApi.getPlayerThumbnail(offererPlayerId);

  const embed = new EmbedBuilder()
    .setTitle(`${label} on ${targetItemName}`)
    .setColor(isOverpay ? 0x00b386 : 0xff4444)
    .setURL(`https://www.rolimons.com/trades`)
    .addFields(
      { name: offererUsername, value: offerLines || '(nothing listed)', inline: true },
      { name: `<@${userDiscordId}>`, value: requestLine + tagLine, inline: true },
      { name: '\u200B', value: `${valueLine}\n${rapLine}` },
    )
    .setFooter({ text: 'RoliTradeAds • Snipe System' })
    .setTimestamp();

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

  return embed;
}

// Start sniping for a user on a specific item.
// snipeConfig: { itemId, itemName, acronym, pingMode, pingThreshold, channel, discordId }
async function startSnipe(snipeConfig) {
  const { itemId, itemName, acronym, pingMode, pingThreshold, channel, discordId } = snipeConfig;
  const key = `${discordId}_${itemId}`;

  if (activeSnipes.has(key)) return { ok: false, reason: 'already_sniping' };

  const seenAdIds = new Set();
  const catalog = await rolimonsApi.getItemCatalog();

  const poll = async () => {
    try {
      const data = await rolimonsApi.getRecentTradeAds();

      // NOTE: We're assuming the response shape is { trade_ads: [...] }
      // or similar — this WILL need a live-test verification pass, same
      // as the inventory and posting endpoints did. We'll log the raw
      // response on first poll so we can fix the shape quickly.
      const ads = data.trade_ads || data.ads || data.tradeAds || [];

      if (!Array.isArray(ads)) {
        console.error('snipe: unexpected getrecentads response shape:', JSON.stringify(data).slice(0, 200));
        return;
      }

      for (const ad of ads) {
        const adId = ad[0] + '_' + (ad[7] || Date.now()); // player_id + timestamp as unique key
        if (seenAdIds.has(adId)) continue;
        seenAdIds.add(adId);

        const requestItemIds = ad[3] || [];
        if (!requestItemIds.map(String).includes(String(itemId))) continue;

        // Check ping mode filter
        if (pingMode !== 'all') {
          const catalog_ = catalog;
          const offerItemIds = ad[2] || [];
          const totalOfferValue = offerItemIds.reduce((sum, id) => {
            const c = catalog_.find(i => String(i.id) === String(id));
            return sum + (c?.value || 0);
          }, 0);
          const targetItem = catalog_.find(i => String(i.id) === String(itemId));
          const targetValue = targetItem?.value || 0;

          if (pingMode === 'overpay' && totalOfferValue <= targetValue) continue;
          if (pingMode === 'threshold') {
            const pct = ((totalOfferValue - targetValue) / targetValue) * 100;
            if (pct < (pingThreshold || 10)) continue;
          }
        }

        // Build and post the embed
        try {
          const embed = await buildSnipeEmbed(ad, itemId, itemName, acronym, catalog, discordId);
          await channel.send({ content: `<@${discordId}>`, embeds: [embed] });
        } catch (embedErr) {
          console.error('snipe: embed build/send error:', embedErr.message);
        }
      }
    } catch (pollErr) {
      console.error('snipe poll error:', pollErr.message);
    }
  };

  // First poll immediately, then on interval
  await poll();
  const handle = setInterval(poll, POLL_INTERVAL_MS);
  activeSnipes.set(key, { itemId, itemName, acronym, handle, seenAdIds, discordId, channelId: channel.id });

  return { ok: true };
}

function stopSnipe(discordId, itemId) {
  const key = `${discordId}_${itemId}`;
  const snipe = activeSnipes.get(key);
  if (!snipe) return false;
  clearInterval(snipe.handle);
  activeSnipes.delete(key);
  return true;
}

function stopAllSnipesForUser(discordId) {
  for (const [key, snipe] of activeSnipes.entries()) {
    if (snipe.discordId === discordId) {
      clearInterval(snipe.handle);
      activeSnipes.delete(key);
    }
  }
}

function getActiveSnipes(discordId) {
  return [...activeSnipes.values()].filter(s => s.discordId === discordId);
}

module.exports = { startSnipe, stopSnipe, stopAllSnipesForUser, getActiveSnipes };
