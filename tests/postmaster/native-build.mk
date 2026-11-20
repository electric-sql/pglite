pglite_native_adapter_directory := $(dir $(lastword $(MAKEFILE_LIST)))
logicalmsgdesc.o: override CPPFLAGS += -include $(pglite_native_adapter_directory)wasm32-wal.h

ifneq ($(PGLITE_TEST_PROVIDER),)
override with_temp_install = \
	PATH="$(PGLITE_TEST_PROVIDER)/bin:$(abs_top_builddir)/tmp_install$(bindir):$(CURDIR):$$PATH" \
	$(call add_to_path,$(strip $(ld_library_path_var)),$(abs_top_builddir)/tmp_install$(libdir)) \
	INITDB_TEMPLATE='$(abs_top_builddir)'/tmp_install/initdb-template \
	$(with_temp_install_extra)

override pg_regress_check = \
	echo "\# +++ regress check in $(subdir) +++" && $(with_temp_install) \
	$(top_builddir)/src/test/regress/pg_regress --temp-instance=./tmp_check \
	--inputdir=$(srcdir) --bindir=$(PGLITE_TEST_PROVIDER)/bin $(TEMP_CONF) \
	$(pg_regress_locale_flags) $(EXTRA_REGRESS_OPTS)

override pg_isolation_regress_check = \
	echo "\# +++ isolation check in $(subdir) +++" && $(with_temp_install) \
	$(top_builddir)/src/test/isolation/pg_isolation_regress --temp-instance=./tmp_check_iso \
	--inputdir=$(srcdir) --outputdir=output_iso --bindir=$(PGLITE_TEST_PROVIDER)/bin \
	$(TEMP_CONF) $(pg_regress_locale_flags) $(EXTRA_REGRESS_OPTS)

override define _create_recursive_target
.PHONY: $(1)-$(2)-recurse
$(1): $(1)-$(2)-recurse
$(1)-$(2)-recurse: $(if $(filter all install check installcheck, $(3)), submake-generated-headers) $(if $(filter check, $(3)), temp-install)
	$(if $(and $(filter check,$(3)),$(PGLITE_TEST_CAPABILITY_RUNNER)),$(PGLITE_TEST_CAPABILITY_RUNNER) --suite '$(if $(filter $(abs_top_builddir),$(CURDIR)),,$(patsubst $(abs_top_builddir)/%,%,$(CURDIR))/)$(2)' --target '$(3)' --) $$(MAKE) -C $(2) $(3)
endef
endif
