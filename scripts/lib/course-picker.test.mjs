/**
 * Scripted-input tests for the course picker.
 *   node scripts/lib/course-picker.test.mjs
 */
import { chooseCourses } from './course-picker.mjs';

const COURSES = [
  'AMTSL -प्रसव के तीसरे चरण का सक्रिय प्रबंधन',
  'Antenatal care',
  'Breastfeeding',
  'Care of LBW new Born',
  'Care of Newborn & Newborn Resuscitation',
  'Care of Sick Newborn',
  'Conducting Normal Delivery',
  'Guidelines for conducting VHNDs and NAHP',
  'Normal Labour & Birth and AMTSL',
].map((name) => ({ name }));

let failures = 0;

async function run(label, answers, expected, { pageSize = 30 } = {}) {
  const queue = [...answers];
  const asked = [];
  const out = [];
  const ask = async (q) => {
    asked.push(q);
    if (!queue.length) throw new Error(`ran out of scripted answers at prompt: ${q.trim().slice(0, 60)}`);
    return queue.shift();
  };

  let got;
  try {
    got = await chooseCourses({ courses: COURSES, ask, print: (s) => out.push(s), pageSize });
  } catch (e) {
    got = `THREW: ${e.message}`;
  }

  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) {
    console.log(`   expected: ${JSON.stringify(expected)}`);
    console.log(`   got     : ${JSON.stringify(got)}`);
    console.log(`   output  :\n${out.join('\n')}`);
  }
  return { asked, out };
}

// 1. Search by keyword, then choose a number from the listed matches.
//    "newborn" hits 2 of the 9 (LBW "new Born" has a space, so it is NOT a hit).
const { out } = await run('search keyword → choose number', ['newborn', '2'],
  ['Care of Sick Newborn']);
// the listing must be numbered from 1 over the FILTERED set
if (!out.join('\n').includes('  1. Care of Newborn & Newborn Resuscitation')) {
  console.log('❌ filtered list is not renumbered from 1'); failures++;
} else console.log('✅ filtered list renumbered from 1');

// 2. Multi-select from the filtered list.
await run('search → choose several', ['care', '1,3'],
  ['Antenatal care', 'Care of Newborn & Newborn Resuscitation']);

// 3. A second keyword re-searches instead of being treated as a bad choice.
await run('re-search with another keyword', ['newborn', 'breast', '1'], ['Breastfeeding']);

// 4. Single match: Enter accepts it.
await run('single match accepted with Enter', ['guidelines', ''],
  ['Guidelines for conducting VHNDs and NAHP']);

// 5. No match → prompts again, then a good search works.
await run('no match re-prompts', ['zzzz', 'antenatal', '1'], ['Antenatal care']);

// 6. Enter at the search prompt lists everything.
await run('empty search lists all', ['', '2'], ['Antenatal care']);

// 7. Out-of-range number is rejected, then a valid one is accepted.
await run('rejects out-of-range number', ['care', '9', '1'], ['Antenatal care']);

// 8. "more" reveals the rest, then a number beyond the first page works.
await run('more expands the page', ['', 'more', '9'], ['Normal Labour & Birth and AMTSL'], { pageSize: 3 });

// 9. "all" runs every match (confirmed when more than 5).
await run('all with confirmation', ['care', 'all'],
  ['Antenatal care', 'Care of LBW new Born', 'Care of Newborn & Newborn Resuscitation', 'Care of Sick Newborn']);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll picker tests passed');
process.exit(failures ? 1 : 0);
