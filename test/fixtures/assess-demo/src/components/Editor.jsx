import { useState } from 'react';
import { createEditor, Transforms } from 'slate';

const initial = [{ type: 'paragraph', children: [{ text: 'Hello' }] }];

export default function Editor() {
  const [editor] = useState(() => createEditor());
  const [value, setValue] = useState(initial);

  const insertParagraph = () => {
    Transforms.insertNodes(editor, {
      type: 'paragraph',
      children: [{ text: 'New paragraph' }],
    });
    setValue(editor.children);
  };

  return (
    <div>
      <button onClick={insertParagraph}>Add paragraph</button>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
