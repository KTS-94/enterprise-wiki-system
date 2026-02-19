/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 커스텀 확장 구성 (댓글, 한컴, Excel 등)
 */
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Underline } from "@tiptap/extension-underline";
import { Superscript } from "@tiptap/extension-superscript";
import SubScript from "@tiptap/extension-subscript";
import { Highlight } from "@tiptap/extension-highlight";
import { Typography } from "@tiptap/extension-typography";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import SlashCommand from "@/features/editor/extensions/slash-command";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCursor } from "@tiptap/extension-collaboration-cursor";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Comment,
  Details,
  DetailsContent,
  DetailsSummary,
  MathBlock,
  MathInline,
  TableCell,
  TableRow,
  TableHeader,
  CustomTable,
  TrailingNode,
  TiptapImage,
  Callout,
  TiptapVideo,
  LinkExtension,
  Selection,
  Attachment,
  CustomCodeBlock,
  Drawio,
  Excalidraw,
  Embed,
  SearchAndReplace,
  Mention,
  DatePicker,
  DateRangePicker,
  SpacePageIndex,
} from "@docmost/editor-ext";
import {
  randomElement,
  userColors,
} from "@/features/editor/extensions/utils.ts";
import { IUser } from "@/features/user/types/user.types.ts";
import MathInlineView from "@/features/editor/components/math/math-inline.tsx";
import MathBlockView from "@/features/editor/components/math/math-block.tsx";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { Youtube } from "@tiptap/extension-youtube";
import ImageView from "@/features/editor/components/image/image-view.tsx";
import CalloutView from "@/features/editor/components/callout/callout-view.tsx";
import { common, createLowlight } from "lowlight";
import VideoView from "@/features/editor/components/video/video-view.tsx";
import AttachmentView from "@/features/editor/components/attachment/attachment-view.tsx";
import CodeBlockView from "@/features/editor/components/code-block/code-block-view.tsx";
import DrawioView from "../components/drawio/drawio-view";
import ExcalidrawView from "@/features/editor/components/excalidraw/excalidraw-view.tsx";
import EmbedView from "@/features/editor/components/embed/embed-view.tsx";
import DatePickerView from "@/features/editor/components/date/date-picker.tsx";
import DateRangePickerView from "@/features/editor/components/date/date-range-picker.tsx";
import SpacePageIndexView from "@/features/editor/components/space-page-index/space-page-index-view.tsx";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import abap from "highlightjs-sap-abap";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import clojure from "highlight.js/lib/languages/clojure";
import fortran from "highlight.js/lib/languages/fortran";
import haskell from "highlight.js/lib/languages/haskell";
import scala from "highlight.js/lib/languages/scala";
import mentionRenderItems from "@/features/editor/components/mention/mention-suggestion.ts";
import { ReactNodeViewRenderer, ReactNodeViewProps } from "@tiptap/react";
import MentionView from "@/features/editor/components/mention/mention-view.tsx";
import i18n from "@/i18n.ts";
import { MarkdownClipboard } from "@/features/editor/extensions/markdown-clipboard.ts";
import EmojiCommand from "./emoji-command";
import { CharacterCount } from "@tiptap/extension-character-count";
import { countWords } from "alfaaz";
import { getDisplayName } from "@/lib/utils.tsx";
import { ExcelPasteTable } from "@/features/editor/extensions/excel-paste-table";
import { HancomPasteHandler } from "@/features/editor/extensions/hancom-paste-handler";

const lowlight = createLowlight(common);
lowlight.register("mermaid", plaintext);
lowlight.register("powershell", powershell);
lowlight.register("abap", abap);
lowlight.register("erlang", erlang);
lowlight.register("elixir", elixir);
lowlight.register("dockerfile", dockerfile);
lowlight.register("clojure", clojure);
lowlight.register("fortran", fortran);
lowlight.register("haskell", haskell);
lowlight.register("scala", scala);

export const mainExtensions = [
  StarterKit.configure({
    history: false,
    dropcursor: {
      width: 3,
      color: "#70CFF8",
    },
    codeBlock: false,
    code: {
      HTMLAttributes: {
        spellcheck: false,
      },
    },
  }),
  ExcelPasteTable.configure(),
  HancomPasteHandler.configure(),
  Placeholder.configure({
    placeholder: ({ node }) => {
      if (node.type.name === "heading") {
        return i18n.t("Heading {{level}}", { level: node.attrs.level });
      }
      if (node.type.name === "detailsSummary") {
        return i18n.t("Toggle title");
      }
      if (node.type.name === "paragraph") {
        return i18n.t('Write anything. Enter "/" for commands');
      }
    },
    includeChildren: true,
    showOnlyWhenEditable: true,
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  Underline,
  LinkExtension.configure({
    openOnClick: false,
  }),
  Superscript,
  SubScript,
  Highlight.configure({
    multicolor: true,
  }),
  Typography,
  TrailingNode,
  GlobalDragHandle,
  TextStyle,
  Color,
  SlashCommand,
  EmojiCommand,
  Comment.configure({
    HTMLAttributes: {
      class: "comment-mark",
    },
  }),
  Mention.configure({
    suggestion: {
      allowSpaces: true,
      items: () => {
        return [];
      },
      // @ts-ignore
      render: mentionRenderItems,
    },
    HTMLAttributes: {
      class: "mention",
    },
  }).extend({
    addNodeView() {
      return ReactNodeViewRenderer(MentionView);
    },
  }),
  CustomTable.configure({
    resizable: true,
    lastColumnResizable: true,
    allowTableNodeSelection: true,
  }),
  TableRow,
  TableCell,
  TableHeader,
  MathInline.configure({
    view: MathInlineView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  MathBlock.configure({
    view: MathBlockView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  Details,
  DetailsSummary,
  DetailsContent,
  Youtube.configure({
    addPasteHandler: false,
    controls: true,
    nocookie: true,
  }),
  TiptapImage.configure({
    view: ImageView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
    allowBase64: false,
  }),
  TiptapVideo.configure({
    view: VideoView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  Callout.configure({
    view: CalloutView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  CustomCodeBlock.configure({
    view: CodeBlockView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
    lowlight,
    HTMLAttributes: {
      spellcheck: false,
    },
  }),
  Selection,
  Attachment.configure({
    view: AttachmentView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  Drawio.configure({
    view: DrawioView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  Excalidraw.configure({
    view: ExcalidrawView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  Embed.configure({
    view: EmbedView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
  MarkdownClipboard.configure({
    transformPastedText: true,
  }),
  CharacterCount.configure({
    wordCounter: (text) => countWords(text),
  }),
  SearchAndReplace.extend({
    addKeyboardShortcuts() {
      return {
        'Mod-f': () => {
          const event = new CustomEvent("openFindDialogFromEditor", {});
          document.dispatchEvent(event);
          return true;
        },
        'Escape': () => {
          const event = new CustomEvent("closeFindDialogFromEditor", {});
          document.dispatchEvent(event);
          return true;
        },
      }
    },
  }).configure(),
  DatePicker.extend({
    addNodeView() {
      return ReactNodeViewRenderer(DatePickerView);
    },
  }),
  DateRangePicker.extend({
    addNodeView() {
      return ReactNodeViewRenderer(DateRangePickerView);
    },
  }),
  SpacePageIndex.configure({
    view: SpacePageIndexView as React.ComponentType<ReactNodeViewProps<HTMLElement>>,
  }),
] as any;

type CollabExtensions = (provider: HocuspocusProvider, user: IUser) => any[];

export const collabExtensions: CollabExtensions = (provider, user) => [
  Collaboration.configure({
    document: provider.document,
  }),
  CollaborationCursor.configure({
    provider,
    user: {
      workspaceId: user.workspaceId,
      usercode: user.usercode,
      name: getDisplayName(user.multidisplayname),
      photopath: user.photopath,
      companycode: user.companycode,
      companyname: user.companyname,
      deptcode: user.deptcode,
      deptname: user.deptname,
      joblevel: user.joblevel,
      jobtitle: user.jobtitle,
      jobposition: user.jobposition,
      color: randomElement(userColors),
    },
  }),
];
