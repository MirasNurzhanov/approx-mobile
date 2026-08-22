// The action rail's icons are Aura's own, and stay that way.
//
// The brief for the viewing experience was explicit: like, comment, repost and
// reveal-location are drawn for this app, in vector paths, and not pulled from
// an icon pack. That is easy to satisfy once and easy to lose later — an icon
// pack is right there, already a dependency, and swapping one glyph for a
// stock one during a hurried change would look like a tidy-up rather than a
// regression.
//
// So this asserts the two halves separately: that each icon renders real SVG
// paths, and that nothing under `components/swifts/` imports an icon pack at
// all. The second is the one that would catch a partial replacement.

import fs from 'fs';
import path from 'path';

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Path } from 'react-native-svg';

import {
  SwiftCommentIcon,
  SwiftLikeIcon,
  SwiftLocationIcon,
  SwiftRepostIcon,
  type SwiftIconComponent,
} from '../../components/swifts/icons';

const SWIFTS_DIR = path.resolve(__dirname, '..', '..', 'components', 'swifts');

/** The packs available in this project. Any of them appearing in the Swifts
 *  tree is the regression. */
const ICON_PACKS = [
  '@expo/vector-icons',
  'react-native-vector-icons',
  'lucide-react-native',
  'Ionicons',
  'MaterialIcons',
  'MaterialCommunityIcons',
  'FontAwesome',
  'Feather',
  'AntDesign',
];

/** The four the brief names, plus the states each has to carry. */
const REQUIRED: [string, SwiftIconComponent][] = [
  ['SwiftLikeIcon', SwiftLikeIcon],
  ['SwiftCommentIcon', SwiftCommentIcon],
  ['SwiftRepostIcon', SwiftRepostIcon],
  ['SwiftLocationIcon', SwiftLocationIcon],
];

/** `create` has to run inside `act` on a concurrent root, or the renderer
 *  is torn down before anything can be read off it. */
function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(element); });
  return tree;
}

function paths(tree: ReactTestRenderer) {
  return tree.root.findAllByType(Path);
}

describe.each(REQUIRED)('%s', (name, Icon) => {
  it('draws vector paths rather than a glyph or a bitmap', () => {
    const tree = render(<Icon />);
    const drawn = paths(tree);

    expect(drawn.length).toBeGreaterThan(0);
    for (const node of drawn) {
      // A real path command, not an empty or placeholder `d`.
      expect(String(node.props.d)).toMatch(/[MmLlCcQqAaHhVvZz]/);
    }
    act(() => { tree.unmount(); });
  });

  it('scales, because it is a path and not a bitmap', () => {
    const small = render(<Icon size={16} />);
    const large = render(<Icon size={64} />);

    // Same drawing at both sizes — a bitmap swap would change the tree.
    expect(paths(small).map((n) => n.props.d))
      .toEqual(paths(large).map((n) => n.props.d));

    act(() => { small.unmount(); large.unmount(); });
  });

  it('has a distinct engaged state', () => {
    // Distinguishable, which is the actual contract — not "filled".
    //
    // Like and location fill their silhouette when engaged. Repost cannot:
    // it is a cycle of open arrows with no interior, so it signals state by
    // colour, and the rail gives it green. Asserting a fill change here failed
    // on repost for that reason, and the icon was right.
    //
    // Colour alone is never the only cue on screen — `SwiftActions` sets
    // `accessibilityState={{ selected }}` on every button — so a colour-only
    // state is legitimate here in a way it would not be on its own.
    const off = render(<Icon on={false} color="#FFFFFF" />);
    const on = render(<Icon on color="#FFFFFF" onColor="#FF0000" />);

    expect(JSON.stringify(on.toJSON())).not.toEqual(JSON.stringify(off.toJSON()));

    act(() => { off.unmount(); on.unmount(); });
  });

  it('honours the tint it is given', () => {
    // Compared, not matched. `react-native-svg` resolves a colour to an ARGB
    // integer in its rendered props (#123456 becomes 4279383126), so asserting
    // on the hex string tests the serialiser rather than the icon. What the
    // icon actually promises is that the colour reaches the paths: two tints
    // must differ, and one tint must be stable.
    const blue = render(<Icon color="#123456" />);
    const red = render(<Icon color="#FF0000" />);
    const blueAgain = render(<Icon color="#123456" />);

    expect(JSON.stringify(blue.toJSON())).not.toEqual(JSON.stringify(red.toJSON()));
    expect(JSON.stringify(blue.toJSON())).toEqual(JSON.stringify(blueAgain.toJSON()));

    act(() => { blue.unmount(); red.unmount(); blueAgain.unmount(); });
  });
});

describe('the Swifts tree imports no icon pack', () => {
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it('has no icon-pack import anywhere under components/swifts', () => {
    const offenders: string[] = [];
    for (const file of sources(SWIFTS_DIR)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pack of ICON_PACKS) {
        if (text.includes(pack)) {
          offenders.push(`${path.relative(SWIFTS_DIR, file)}: ${pack}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would notice if one appeared', () => {
    // The scan above passes trivially if the directory walk is broken, which
    // is exactly the sort of thing that goes unnoticed in a guard.
    const files = sources(SWIFTS_DIR);
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith('icons.tsx'))).toBe(true);
  });
});
