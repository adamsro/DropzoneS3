require 'compass/import-once/activate'

require 'sass'
require 'cgi'

# Require any additional compass plugins here.

# Set this to the root of your project when deployed:
# http_path = "/"
#
#Folder settings
relative_assets = true      #because we're not working from the root
css_dir = "./dist"          #where the CSS will saved
sass_dir = "./src"           #where our .scss files are
images_dir = "./assets"    #the folder with your images

# You can select your preferred output style here (can be overridden via the command line):
# output_style = :expanded or :nested or :compact or :compressed

# To enable relative paths to assets via compass helper functions. Uncomment:
# relative_assets = true

# To disable debugging comments that display the original location of your selectors. Uncomment:
# line_comments = false


# If you prefer the indented syntax, you might want to regenerate this
# project again passing --syntax sass, or you can uncomment this:
# preferred_syntax = :sass
# and then run:
# sass-convert -R --from scss --to sass sass scss && rm -rf sass && mv scss sass


# https://github.com/Compass/compass/issues/1460

module Sass::Script::Functions

  def inline_svg_image(path)
    real_path = File.join(Compass.configuration.images_path, path.value)
    svg = data(real_path)
    encoded_svg = CGI::escape(svg).gsub('+', '%20')
    data_url = "url('data:image/svg+xml;charset=utf-8," + encoded_svg + "')"
    Sass::Script::String.new(data_url)
  end

private

  def data(real_path)
    if File.readable?(real_path)
      File.open(real_path, "rb") {|io| io.read}
    else
      raise Compass::Error, "File not found or cannot be read: #{real_path}"
    end
  end

end
