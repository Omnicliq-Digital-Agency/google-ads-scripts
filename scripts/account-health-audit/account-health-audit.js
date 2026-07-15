/**
 * Account Health Audit
 *
 * Accounts rot quietly: an ad gets disapproved, an ad group loses its last
 * ad, conversions stop reporting, a campaign starves on budget - each one
 * invisible until it has cost real money. This script runs a battery of
 * health checks over the whole account on a schedule and emails one digest
 * of everything it finds. It changes nothing; it is the smoke detector, not
 * the fire brigade.
 *
 * The checks (each can be switched off in CONFIG.CHECKS):
 *   DISAPPROVED_ADS     - disapproved / limited ads in enabled ad groups
 *   ADS_PER_AD_GROUP    - ad groups with no enabled ads, or more than
 *                         MAX_ADS_PER_AD_GROUP
 *   KEYWORDS_PER_AD_GROUP - keyword ad groups with no enabled keywords, or
 *                         where every keyword is 'low search volume'
 *   RSA_STRENGTH        - responsive search ads with POOR ad strength
 *   CONVERSION_TRACKING - no conversions (or no conversion value, if
 *                         REQUIRE_CONVERSION_VALUE) in the lookback window
 *   LOST_BUDGET         - campaigns losing more than MAX_LOST_BUDGET_SHARE
 *                         of search impression share to budget
 *   ZERO_IMPRESSIONS    - enabled campaigns with no impressions in the window
 *   DISPLAY_SELECT      - search campaigns also serving on Display
 *   WRONG_DOMAIN        - ad final URLs pointing outside EXPECTED_DOMAINS
 *
 * Setup:
 *   1. Review CONFIG below - fill EXPECTED_DOMAINS and RECIPIENT_EMAILS,
 *      switch off checks that don't apply to the account.
 *   2. Run with PREVIEW_MODE: true first. Read the findings in the logs;
 *      no email is sent.
 *   3. Set PREVIEW_MODE: false and schedule (daily).
 *
 * @author Dimitris Bachtsevanis <db@omnicliq.com> (Omnicliq)
 *
 * Copyright 2026 Omnicliq
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const CONFIG = {
    // true: log findings only, send no email.
    // false: send the digest email when there are findings.
    PREVIEW_MODE: true,

    // Who receives the digest.
    RECIPIENT_EMAILS: [],

    // Switch individual checks on/off.
    CHECKS: {
        DISAPPROVED_ADS: true,
        ADS_PER_AD_GROUP: true,
        KEYWORDS_PER_AD_GROUP: true,
        RSA_STRENGTH: true,
        CONVERSION_TRACKING: true,
        LOST_BUDGET: true,
        ZERO_IMPRESSIONS: true,
        DISPLAY_SELECT: true,
        WRONG_DOMAIN: true,
    },

    // Domains your ads are allowed to land on (host suffix match, so
    // 'example.com' also covers 'www.example.com'). Empty disables
    // WRONG_DOMAIN even when switched on.
    EXPECTED_DOMAINS: [],

    // Performance-based checks look at this window, ending yesterday.
    LOOKBACK_DAYS: 14,

    // ADS_PER_AD_GROUP: more enabled ads than this is a finding.
    MAX_ADS_PER_AD_GROUP: 5,

    // LOST_BUDGET: losing more than this share (0..1) of search impression
    // share to budget is a finding.
    MAX_LOST_BUDGET_SHARE: 0.1,

    // CONVERSION_TRACKING: also require conversion VALUE, not just
    // conversions - keep on for e-commerce, off for lead gen.
    REQUIRE_CONVERSION_VALUE: false,

    // Campaigns whose name contains any of these are skipped everywhere.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    validateConfig();

    const auditor = new HealthAuditor();
    auditor.audit();
}

function validateConfig() {
    if (!CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length === 0) {
        throw new Error('RECIPIENT_EMAILS is empty. Add at least one address ' +
            'or keep PREVIEW_MODE: true.');
    }
    if (CONFIG.CHECKS.WRONG_DOMAIN && CONFIG.EXPECTED_DOMAINS.length === 0) {
        Logger.log('Note: WRONG_DOMAIN is on but EXPECTED_DOMAINS is empty - the check is skipped.');
    }
}

function HealthAuditor() {

    const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
    const dateTo = formattedDate(-1);
    // finding: { check, entity, detail }
    const findings = [];

    this.audit = function () {
        const checks = [
            { key: 'DISAPPROVED_ADS', run: checkDisapprovedAds },
            { key: 'ADS_PER_AD_GROUP', run: checkAdsPerAdGroup },
            { key: 'KEYWORDS_PER_AD_GROUP', run: checkKeywordsPerAdGroup },
            { key: 'RSA_STRENGTH', run: checkRsaStrength },
            { key: 'CONVERSION_TRACKING', run: checkConversionTracking },
            { key: 'LOST_BUDGET', run: checkLostBudget },
            { key: 'ZERO_IMPRESSIONS', run: checkZeroImpressions },
            { key: 'DISPLAY_SELECT', run: checkDisplaySelect },
            { key: 'WRONG_DOMAIN', run: checkWrongDomain },
        ];

        for (const check of checks) {
            if (!CONFIG.CHECKS[check.key]) {
                continue;
            }
            Logger.log('Running ' + check.key + '...');
            const before = findings.length;
            check.run();
            Logger.log('  ' + (findings.length - before) + ' finding(s)');
        }

        if (!CONFIG.PREVIEW_MODE && findings.length > 0) {
            sendDigest();
        }

        logSummary();
    };

    function report(check, entity, detail) {
        findings.push({ check: check, entity: entity, detail: detail });
        Logger.log('  [' + check + '] ' + entity + ' - ' + detail);
    }

    function checkDisapprovedAds() {
        const rows = search(
            'SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ' +
            'ad_group_ad.policy_summary.approval_status ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\' ' +
            'AND ad_group_ad.policy_summary.approval_status IN ' +
            '(\'DISAPPROVED\', \'APPROVED_LIMITED\', \'AREA_OF_INTEREST_ONLY\')');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            report('DISAPPROVED_ADS',
                row.campaign.name + ' > ' + row.adGroup.name + ' > ad ' + row.adGroupAd.ad.id,
                row.adGroupAd.policySummary.approvalStatus);
        }
    }

    function checkAdsPerAdGroup() {
        const enabledAdCounts = countByAdGroup(
            'SELECT campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\'');

        forEachEnabledAdGroup(function (adGroupKey, name) {
            const count = enabledAdCounts[adGroupKey] || 0;
            if (count === 0) {
                report('ADS_PER_AD_GROUP', name, 'no enabled ads');
            } else if (count > CONFIG.MAX_ADS_PER_AD_GROUP) {
                report('ADS_PER_AD_GROUP', name, count + ' enabled ads (max ' +
                    CONFIG.MAX_ADS_PER_AD_GROUP + ')');
            }
        });
    }

    function checkKeywordsPerAdGroup() {
        // Ad groups that have keywords at all (keyword-targeted, not DSA).
        const totalCounts = countByAdGroup(
            'SELECT campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false');
        const servingCounts = countByAdGroup(
            'SELECT campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.status = \'ENABLED\' ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false ' +
            'AND ad_group_criterion.system_serving_status = \'ELIGIBLE\'');

        for (const adGroupKey in totalCounts) {
            const total = totalCounts[adGroupKey];
            const serving = servingCounts[adGroupKey] || 0;
            if (serving === 0) {
                report('KEYWORDS_PER_AD_GROUP', total.name,
                    'none of ' + total.count + ' keywords is eligible to serve ' +
                    '(paused or low search volume)');
            }
        }
    }

    function checkRsaStrength() {
        const rows = search(
            'SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ' +
            'ad_group_ad.ad_strength ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\' ' +
            'AND ad_group_ad.ad.type = \'RESPONSIVE_SEARCH_AD\' ' +
            'AND ad_group_ad.ad_strength = \'POOR\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            report('RSA_STRENGTH',
                row.campaign.name + ' > ' + row.adGroup.name + ' > ad ' + row.adGroupAd.ad.id,
                'POOR ad strength');
        }
    }

    function checkConversionTracking() {
        const rows = search(
            'SELECT metrics.conversions, metrics.conversions_value ' +
            'FROM customer ' +
            'WHERE segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        let conversions = 0;
        let value = 0;
        while (rows.hasNext()) {
            const row = rows.next();
            conversions += Number(row.metrics.conversions) || 0;
            value += Number(row.metrics.conversionsValue) || 0;
        }
        if (conversions === 0) {
            report('CONVERSION_TRACKING', 'Account',
                'no conversions reported between ' + dateFrom + ' and ' + dateTo);
        } else if (CONFIG.REQUIRE_CONVERSION_VALUE && value === 0) {
            report('CONVERSION_TRACKING', 'Account',
                conversions + ' conversions but zero conversion value between ' +
                dateFrom + ' and ' + dateTo);
        }
    }

    function checkLostBudget() {
        const rows = search(
            'SELECT campaign.name, metrics.search_budget_lost_impression_share ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND campaign.advertising_channel_type = \'SEARCH\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        const worstByCampaign = {};
        while (rows.hasNext()) {
            const row = rows.next();
            const share = Number(row.metrics.searchBudgetLostImpressionShare) || 0;
            const name = row.campaign.name;
            if (worstByCampaign[name] === undefined || share > worstByCampaign[name]) {
                worstByCampaign[name] = share;
            }
        }
        for (const name in worstByCampaign) {
            if (!campaignQualifies(name)) {
                continue;
            }
            if (worstByCampaign[name] > CONFIG.MAX_LOST_BUDGET_SHARE) {
                report('LOST_BUDGET', name,
                    Math.round(worstByCampaign[name] * 100) + '% of search impression ' +
                    'share lost to budget on its worst day');
            }
        }
    }

    function checkZeroImpressions() {
        const rows = search(
            'SELECT campaign.name, metrics.impressions ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        const totalByCampaign = {};
        while (rows.hasNext()) {
            const row = rows.next();
            totalByCampaign[row.campaign.name] =
                (totalByCampaign[row.campaign.name] || 0) +
                (parseInt(row.metrics.impressions, 10) || 0);
        }
        for (const name in totalByCampaign) {
            if (!campaignQualifies(name)) {
                continue;
            }
            if (totalByCampaign[name] === 0) {
                report('ZERO_IMPRESSIONS', name,
                    'no impressions between ' + dateFrom + ' and ' + dateTo);
            }
        }
    }

    function checkDisplaySelect() {
        const rows = search(
            'SELECT campaign.name, campaign.network_settings.target_content_network ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND campaign.advertising_channel_type = \'SEARCH\' ' +
            'AND campaign.network_settings.target_content_network = true');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            report('DISPLAY_SELECT', row.campaign.name,
                'search campaign also serving on the Display Network');
        }
    }

    function checkWrongDomain() {
        if (CONFIG.EXPECTED_DOMAINS.length === 0) {
            return;
        }
        const rows = search(
            'SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ' +
            'ad_group_ad.ad.final_urls ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            const finalUrls = row.adGroupAd.ad.finalUrls || [];
            for (const url of finalUrls) {
                const host = extractHost(url);
                if (host && !hostIsExpected(host)) {
                    report('WRONG_DOMAIN',
                        row.campaign.name + ' > ' + row.adGroup.name + ' > ad ' + row.adGroupAd.ad.id,
                        'final URL on unexpected domain: ' + host);
                }
            }
        }
    }

    // ---- shared helpers ----

    function search(query) {
        return AdsApp.search(query);
    }

    function countByAdGroup(query) {
        const counts = {};
        const rows = search(query);
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            const key = row.adGroup.id;
            if (!counts[key]) {
                counts[key] = { count: 0, name: row.campaign.name + ' > ' + row.adGroup.name };
            }
            counts[key].count++;
        }
        return counts;
    }

    function forEachEnabledAdGroup(callback) {
        const rows = search(
            'SELECT campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            callback(row.adGroup.id, row.campaign.name + ' > ' + row.adGroup.name);
        }
    }

    function campaignQualifies(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return false;
            }
        }
        return true;
    }

    function hostIsExpected(host) {
        for (const domain of CONFIG.EXPECTED_DOMAINS) {
            const clean = domain.toLowerCase();
            if (host === clean || endsWith(host, '.' + clean)) {
                return true;
            }
        }
        return false;
    }

    function extractHost(url) {
        const match = /^https?:\/\/([^\/?#]+)/i.exec(url);
        return match ? match[1].toLowerCase() : undefined;
    }

    function endsWith(text, suffix) {
        return text.length >= suffix.length &&
            text.lastIndexOf(suffix) === text.length - suffix.length;
    }

    function sendDigest() {
        const accountName = AdsApp.currentAccount().getName();
        const byCheck = {};
        for (const finding of findings) {
            if (!byCheck[finding.check]) {
                byCheck[finding.check] = [];
            }
            byCheck[finding.check].push(finding);
        }

        const lines = ['Health audit findings for ' + accountName + ':', ''];
        for (const check in byCheck) {
            lines.push('== ' + check + ' (' + byCheck[check].length + ') ==');
            for (const finding of byCheck[check]) {
                lines.push('  ' + finding.entity + ' - ' + finding.detail);
            }
            lines.push('');
        }
        lines.push('Window for performance checks: ' + dateFrom + ' to ' + dateTo + '.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Health audit: ' + findings.length + ' finding(s) in ' + accountName,
            lines.join('\n'));
    }

    function logSummary() {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - no email sent)' : '';
        const perCheck = {};
        for (const finding of findings) {
            perCheck[finding.check] = (perCheck[finding.check] || 0) + 1;
        }
        const breakdown = [];
        for (const check in perCheck) {
            breakdown.push('  ' + check + ': ' + perCheck[check]);
        }
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Total findings: ' + findings.length,
        ].concat(breakdown).concat([
            (findings.length > 0 && !CONFIG.PREVIEW_MODE ? 'Digest email sent.' : ''),
            '====================================================',
        ]).join('\n'));
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}
