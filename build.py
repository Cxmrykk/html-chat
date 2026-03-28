#!/usr/bin/env python3
import os
import glob
import sys

def inject_with_indent(template, placeholder, content):
    """
    Finds the placeholder in the template, calculates the indentation 
    on that line, and indents every line of content to match.
    """
    lines = template.splitlines()
    final_lines = []
    
    for line in lines:
        if placeholder in line:
            # Get the leading whitespace before the placeholder
            indent = line[:line.find(placeholder)]
            # Split content into lines, indent them, and join them
            content_lines = content.strip().splitlines()
            indented_content = "\n".join([f"{indent}{c_line}" if c_line.strip() else "" for c_line in content_lines])
            final_lines.append(indented_content)
        else:
            final_lines.append(line)
            
    return "\n".join(final_lines)

def main():
    SOURCE_FILE = "index.src.html"
    OUTPUT_FILE = "index.html"
    CSS_FILE = "styles.css"
    SCRIPTS_DIR = "scripts"

    try:
        if not os.path.exists(SOURCE_FILE):
            print(f"❌ Error: {SOURCE_FILE} not found.")
            return

        with open(SOURCE_FILE, "r", encoding="utf-8") as f:
            html = f.read()

        # 1. Process CSS
        if os.path.exists(CSS_FILE):
            with open(CSS_FILE, "r", encoding="utf-8") as f:
                css_text = f.read()
            html = inject_with_indent(html, "/* %%% styles.css %%% */", css_text)
        else:
            print(f"⚠️ Warning: {CSS_FILE} missing.")

        # 2. Process JS
        script_files = sorted(glob.glob(os.path.join(SCRIPTS_DIR, "*.js")))
        if script_files:
            js_parts = []
            for f_path in script_files:
                with open(f_path, "r", encoding="utf-8") as f:
                    js_parts.append(f.read().strip())
            
            combined_js = "\n\n".join(js_parts)
            html = inject_with_indent(html, "/* %%% scripts %%% */", combined_js)
        else:
            print(f"⚠️ Warning: No JS found in {SCRIPTS_DIR}/")

        # 3. Write Output
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(html)
        
        print(f"✅ Built {OUTPUT_FILE} with correct indentation.")

    except Exception as e:
        print(f"❌ Build failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
