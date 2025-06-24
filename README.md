# Sambooru

Sambooru is a simple, lightweight, and nostalgic booru-style image board software built with Node.js and Express. It is designed to be highly compatible with older web browsers and does not require any client-side JavaScript.

This project was developed as a friendly alternative to Rust-based boorus, such as [Kyonnaga](https://codeberg.org/PatchMixolydic/kyonnaga), with the goal of building a comparable, if not better, feature set on a Node.js stack.

## Features

*   **Post Management**: Upload images and videos, edit their tags, and delete them.
*   **Image & Video Processing**:
    *   **Image Compression**: Converts all uploaded images to optimized PNG files to save space.
    *   **Video Transcoding**: Automatically transcodes uploaded videos to H.264
*   **Tagging System**: Assign multiple tags to each post, with support for tag categories (e.g., `general`, `character`, `artist`).
*   **Duplicate Detection**: Uses SHA256 hashing to prevent duplicate file uploads.
*   **User Accounts & Moderation**:
    *   **User Accounts**: Users can register and log in to upload content, comment, and favorite posts.
    *   **User-Specific Filtering**: Users can create a personal tag blacklist to hide content they don't wish to see.
    *   **Roles & Permissions**: User roles (`user`, `moderator`, `admin`) provide different levels of permissions.
*   **Comprehensive Admin Panel**: A full dashboard for administrators to manage users, posts, and tags, complete with pagination.
*   **Complex Search**: Search for posts by tags, with support for excluding tags (e.g., `cat -dog`).
*   **Comments**: Registered users can leave comments on posts.
*   **AI-Powered Auto-Tagging**: Integrated with the Ollama `moondream` model to automatically suggest tags for both images and video frames.
*   **Favorites**: Users can mark their favorite posts.
*   **User Profiles**: View a user's profile to see all their uploads.
*   **High Compatibility**: Works on modern and older browsers (Firefox 42 or above or thereabouts) with no client-side JavaScript required.
*   **Name your booru**: Name it. Name it anything you like. 

## Project Structure

```
/
├── src/                # Main application source code
│   ├── db/             # Database setup (Quick.DB)
│   ├── routes/         # Express route handlers
│   ├── views/          # EJS view templates
│   │   ├── admin/      # Admin panel views
│   │   └── partials/   # Reusable view components
│   ├── public/         # Static assets
│   │   ├── css/        # Stylesheets
│   │   ├── images/     # Uploaded full-size images & videos
│   │   └── thumbnails/ # Generated post thumbnails
│   └── app.js          # Main Express application setup
├── uploads/            # Temporary directory for file uploads
├── .env.example        # Example environment file
├── .gitignore          # Files and folders to ignore in version control
└── package.json        # Project dependencies and scripts
```

## Setup and Installation

1.  **Clone the Repository**
    ```bash
    git clone <repository-url>
    cd sambooru
    ```

2.  **Install System Dependencies**
    *   **Node.js**: The runtime environment.
    *   **ffmpeg**: A command-line tool for video processing. This must be installed and available in your system's PATH. You can install it via your system's package manager (e.g., `sudo apt-get install ffmpeg` on Debian/Ubuntu, `brew install ffmpeg` on macOS).

3.  **Install Node.js Dependencies**
    ```bash
    npm install
    ```

4.  **Set Up Ollama (Optional)**
    This project uses Ollama for the auto-tagging feature.
    - Install [Ollama](https://ollama.com/).
    - Pull the `moondream` model:
      ```bash
      ollama pull moondream
      ```
    - Ensure the Ollama server is running.

5.  **Create Environment File**
    - Copy the example `.env` file:
      ```bash
      cp .env.example .env
      ```
    - Edit the `.env` file to set your configuration.

    **Environment Variables:**
    *   `BOORU_NAME`: The name of your booru, which will be displayed in page titles and headings (default is `Sambooru`).
    *   `SESSION_SECRET`: A long, random string used to secure user sessions. Generate one with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
    *   `OLLAMA_HOST`: The URL of your running Ollama instance (default is `http://localhost:11434`).
    *   `PORT`: Web Port (default is 3000) 
## Running the Application

Once the setup is complete, you can start the server:

```bash
npm start
```

The application will be running at `http://localhost:3000`. 
