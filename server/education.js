import { XMLParser } from 'fast-xml-parser';
// Links, not copied medical articles. No patient identifiers leave the server.
export const educationLinks = [
  {
    title: 'After a hospital stay',
    description: 'Questions to ask and ways to prepare for your return home.',
    url: 'https://medlineplus.gov/ency/patientinstructions/000867.htm',
    source: 'MedlinePlus',
    label: 'Patient education',
  },
  {
    title: 'Talking with your doctor',
    description: 'Make the most of your next conversation with your care team.',
    url: 'https://medlineplus.gov/talkingwithyourdoctor.html',
    source: 'MedlinePlus',
    label: 'Preparing for a visit',
  },
  {
    title: 'Taking medicines safely',
    description: 'General information to discuss with your pharmacist or clinician.',
    url: 'https://medlineplus.gov/medicines.html',
    source: 'MedlinePlus',
    label: 'General information',
  },
];
const cache = new Map();
const pending = new Map();
const array = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);
export async function lookupEducation(topic = 'discharge') {
  const topics = {
    discharge: 'title:"Talking With Your Doctor" OR title:"Home Care Services"',
    medication: 'title:"Medicines"',
    followup: 'title:"Talking With Your Doctor"',
  };
  if (!Object.hasOwn(topics, topic)) throw new Error('Choose discharge, medication, or followup.');
  const cached = cache.get(topic);
  if (cached && cached.until > Date.now()) return { ...cached.result, cached: true };
  if (pending.has(topic)) return pending.get(topic);
  const request = fetchEducation(topics[topic])
    .then((result) => {
      cache.set(topic, {
        result,
        until: Date.now() + (result.mode === 'live' ? 12 * 60 * 60 * 1000 : 60000),
      });
      return result;
    })
    .finally(() => pending.delete(topic));
  pending.set(topic, request);
  return request;
}
async function fetchEducation(term) {
  const url = new URL('https://wsearch.nlm.nih.gov/ws/query');
  url.search = new URLSearchParams({
    db: 'healthTopics',
    term,
    retmax: '3',
    tool: 'homeward-hackathon',
  }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Education service returned ${response.status}`);
    const xml = await response.text();
    if (xml.length > 1000000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('Unsupported response.');
    const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true }).parse(xml);
    const entries = array(parsed.nlmSearchResult?.list?.document);
    const links = entries
      .filter((e) => {
        try {
          const link = new URL(e['@_url']);
          return (
            link.protocol === 'https:' &&
            ['medlineplus.gov', 'www.medlineplus.gov'].includes(link.hostname)
          );
        } catch {
          return false;
        }
      })
      .map((e) => {
        const title = array(e.content).find((c) => c['@_name'] === 'title')?.['#text'];
        return {
          title: typeof title === 'string' ? title.replace(/<[^>]*>/g, '') : 'MedlinePlus resource',
          url: e['@_url'],
          source: 'MedlinePlus.gov',
          label: 'Live resource',
          description:
            'General patient education. Your discharge instructions remain the source for your care plan.',
        };
      });
    return {
      mode: links.length ? 'live' : 'curated',
      retrievedAt: new Date().toISOString(),
      links: links.length ? links : educationLinks,
      note: links.length
        ? 'Retrieved from the MedlinePlus Web Service. Results are cached for 12 hours. General education only.'
        : 'Service responded with no matches. Showing curated MedlinePlus links.',
    };
  } catch {
    return {
      mode: 'fallback',
      retrievedAt: null,
      links: educationLinks,
      note: 'Live education lookup is unavailable. Showing curated links; no patient instructions were changed.',
    };
  }
}
